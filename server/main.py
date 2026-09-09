"""书签同步服务器（FastAPI + SQLite）

启动方式:
    pip install -r requirements.txt
    SYNC_TOKEN=换成你自己的密钥 uvicorn main:app --host 0.0.0.0 --port 8000

接口:
    POST /push          推送本地变更（新增 / 修改 / 删除墓碑）
    GET  /pull?since=N  拉取版本号大于 N 的全部变更
    GET  /health        健康检查
"""

import os
import sqlite3
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

TOKEN = os.environ.get("SYNC_TOKEN", "change-me")
DB_PATH = os.environ.get("SYNC_DB", "bookmarks.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS bookmarks (
                sid     INTEGER PRIMARY KEY AUTOINCREMENT,
                url     TEXT NOT NULL DEFAULT '',
                title   TEXT NOT NULL DEFAULT '',
                folder  TEXT NOT NULL DEFAULT '',
                deleted INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_version ON bookmarks(version)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_url ON bookmarks(url)")
        conn.commit()
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="bookmark-sync", lifespan=lifespan)


def check_token(request: Request):
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


class Item(BaseModel):
    sid: Optional[int] = None
    url: str = ""
    title: str = ""
    folder: str = ""
    deleted: bool = False


class PushBody(BaseModel):
    items: List[Item]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/push")
def push(body: PushBody, request: Request):
    check_token(request)
    conn = get_db()
    try:
        version = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM bookmarks"
        ).fetchone()["v"]
        result = []
        for it in body.items:
            version += 1
            if it.sid is not None:
                # 已有条目：更新或打墓碑（墓碑保留原 url/title/folder，便于日后复活去重）
                if it.deleted:
                    conn.execute(
                        "UPDATE bookmarks SET deleted = 1, version = ? WHERE sid = ?",
                        (version, it.sid),
                    )
                else:
                    conn.execute(
                        "UPDATE bookmarks SET url = ?, title = ?, folder = ?, deleted = 0, version = ? WHERE sid = ?",
                        (it.url, it.title, it.folder, version, it.sid),
                    )
                result.append({"sid": it.sid})
            else:
                # 新增：同 URL 已存在则复用（两台设备先后添加同一书签 / 删除后重新添加）
                row = conn.execute(
                    "SELECT sid FROM bookmarks WHERE url = ? ORDER BY deleted, version DESC LIMIT 1",
                    (it.url,),
                ).fetchone()
                if row:
                    conn.execute(
                        "UPDATE bookmarks SET title = ?, folder = ?, deleted = 0, version = ? WHERE sid = ?",
                        (it.title, it.folder, version, row["sid"]),
                    )
                    result.append({"sid": row["sid"]})
                else:
                    cur = conn.execute(
                        "INSERT INTO bookmarks (url, title, folder, deleted, version) VALUES (?, ?, ?, 0, ?)",
                        (it.url, it.title, it.folder, version),
                    )
                    result.append({"sid": cur.lastrowid})
        conn.commit()
        return {"version": version, "items": result}
    finally:
        conn.close()


@app.get("/pull")
def pull(request: Request, since: int = 0):
    check_token(request)
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT sid, url, title, folder, deleted, version FROM bookmarks WHERE version > ? ORDER BY version",
            (since,),
        ).fetchall()
        current = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM bookmarks"
        ).fetchone()["v"]
        return {"version": current, "items": [dict(r) for r in rows]}
    finally:
        conn.close()
