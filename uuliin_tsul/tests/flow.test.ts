import assert from "node:assert/strict";
import test from "node:test";
import { loadParked } from "../lib/flow";

test("маршрутын файл татаж чадаагүй бол дараагийн удаа дахин оролдож, амжилттайг санана", async () => {
  let calls = 0;
  const replies = [
    new Response(JSON.stringify({ detail: "Нэвтрэх шаардлагатай" }), { status: 401 }),
    new Response(JSON.stringify({ _parked: [[104.1, 49.0, 90]] }), { status: 200 }),
  ];
  globalThis.fetch = (async () => {
    calls++;
    return replies.shift() ?? new Response("{}", { status: 500 });
  }) as typeof fetch;

  assert.deepEqual(await loadParked(), []);
  assert.equal((await loadParked()).length, 1);
  assert.equal((await loadParked()).length, 1);
  assert.equal(calls, 2);
});
