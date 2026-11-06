import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelLoginCode, confirmLoginCode, createLoginCode, isLoginCodeOpen, signWebSession, takeLoginCode, verifyWebSession } from "./webAuth.js";

test("вход на сайт: код подтверждается один раз", () => {
  const code = createLoginCode();
  assert.match(code, /^[A-Za-z0-9_-]{24}$/);
  assert.deepEqual(takeLoginCode(code), { status: "pending" });
  assert.equal(confirmLoginCode(code, 42), true);
  // повторно подтвердить нельзя, бот покажет «ссылка устарела»
  assert.equal(confirmLoginCode(code, 43), false);
  assert.equal(isLoginCodeOpen(code), false);
  assert.deepEqual(takeLoginCode(code), { status: "confirmed", userId: 42 });
  // токен выдаётся один раз
  assert.deepEqual(takeLoginCode(code), { status: "expired" });
  assert.deepEqual(takeLoginCode("nope"), { status: "expired" });

  const other = createLoginCode();
  cancelLoginCode(other);
  assert.equal(confirmLoginCode(other, 42), false);
});

test("токен сессии сайта", () => {
  const t = signWebSession(7, "bot-token");
  assert.equal(verifyWebSession(t, "bot-token"), 7);
  assert.equal(verifyWebSession(t, "other-token"), null);
  assert.equal(verifyWebSession(t.replace("w1.7.", "w1.8."), "bot-token"), null);
  assert.equal(verifyWebSession(signWebSession(7, "bot-token", -10), "bot-token"), null);
  assert.equal(verifyWebSession("", "bot-token"), null);
});
