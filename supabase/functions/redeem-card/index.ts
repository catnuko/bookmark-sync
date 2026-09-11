// Redeem a generation card key.
//
// Security model (per the project's Supabase integration spec):
//   - The card_keys table is NOT readable by normal users (RLS denies). All
//     validation happens HERE, using the service_role key.
//   - The caller's JWT is verified via getUser(); only the owner can add
//     generations to their own profile.
//   - remaining_generations is mutated ONLY here (or by consume_generation()),
//     never from the client.
//
// Deploy:
//   supabase functions deploy redeem-card
// (verify_jwt is disabled in config.toml because we validate the JWT manually.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // 1. Verify login state from the bearer token.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, msg: "未登录" }), {
      status: 401,
    });
  }
  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ success: false, msg: "未登录" }), {
      status: 401,
    });
  }

  // 2. Read the card code + project_id from the request body.
  let card_code: string;
  let project_id: string | undefined;
  try {
    ({ card_code, project_id } = await req.json());
  } catch {
    return new Response(JSON.stringify({ success: false, msg: "请求格式错误" }), {
      status: 400,
    });
  }
  card_code = (card_code ?? "").trim();
  if (!card_code) {
    return new Response(JSON.stringify({ success: false, msg: "卡密不能为空" }), {
      status: 400,
    });
  }
  if (!project_id) {
    return new Response(JSON.stringify({ success: false, msg: "缺少 project_id" }), {
      status: 400,
    });
  }

  // 3. Find an unused card key (scoped to this project/tenant).
  const { data: card, error: cardErr } = await supabase
    .from("card_keys")
    .select("*")
    .eq("card_code", card_code)
    .eq("is_used", false)
    .eq("project_id", project_id)
    .single();

  if (cardErr || !card) {
    return new Response(
      JSON.stringify({ success: false, msg: "卡密无效或已被使用" }),
      { status: 400 },
    );
  }

  // 4. Mark the card as used.
  const { error: markErr } = await supabase
    .from("card_keys")
    .update({
      is_used: true,
      used_by: user.id,
      used_at: new Date().toISOString(),
    })
    .eq("id", card.id);
  if (markErr) {
    return new Response(
      JSON.stringify({ success: false, msg: "兑换失败，请重试" }),
      { status: 500 },
    );
  }

  // 5. Add generations to the user's profile (scoped to this project).
  const reward = Number(card.reward_generations);
  const { error: addErr } = await supabase
    .from("profiles")
    .update({
      remaining_generations: supabase.raw(`remaining_generations + ${reward}`),
      last_redeemed_card: card_code,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .eq("project_id", project_id);
  if (addErr) {
    // Roll back the card mark so the user can retry.
    await supabase
      .from("card_keys")
      .update({ is_used: false, used_by: null, used_at: null })
      .eq("id", card.id);
    return new Response(
      JSON.stringify({ success: false, msg: "到账失败，请重试" }),
      { status: 500 },
    );
  }

  // 6. Write the redemption ledger (scoped to this project).
  await supabase.from("card_redemption_records").insert({
    user_id: user.id,
    project_id: project_id,
    card_code: card_code,
    add_generations: reward,
  });

  return new Response(
    JSON.stringify({ success: true, msg: `兑换成功！已到账 ${reward} 次` }),
  );
});
