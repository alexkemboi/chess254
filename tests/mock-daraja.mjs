/**
 * Local stand-in for Safaricom Daraja used ONLY by the test suite (wired in via
 * MPESA_API_BASE_URL). It implements OAuth, STK Push and STK Query with the same
 * request/response shapes as Daraja, and exposes /__control endpoints so tests
 * can complete, cancel or fail a payment and deliver (duplicate) callbacks.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

export const TEST_CREDENTIALS = { key: "test-consumer-key", secret: "test-consumer-secret", passkey: "test-passkey-0123456789", shortcode: "174379" };

export function startMockDaraja(port = 4010) {
  const requests = new Map(); // CheckoutRequestID → record
  const token = `mock-${randomUUID()}`;

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
  const authorised = (req) => req.headers.authorization === `Bearer ${token}`;
  const expectedPassword = (ts) => Buffer.from(`${TEST_CREDENTIALS.shortcode}${TEST_CREDENTIALS.passkey}${ts}`).toString("base64");

  async function deliver(record, times = 1) {
    const meta = record.result === "success"
      ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: record.paidAmount ?? record.amount }, { Name: "MpesaReceiptNumber", Value: record.receipt }, { Name: "TransactionDate", Value: 20261008120000 }, { Name: "PhoneNumber", Value: Number(record.phone) }] } }
      : {};
    const code = record.result === "success" ? 0 : record.result === "cancelled" ? 1032 : 2001;
    const desc = record.result === "success" ? "The service request is processed successfully." : record.result === "cancelled" ? "Request cancelled by user" : "The initiator information is invalid.";
    const payload = { Body: { stkCallback: { MerchantRequestID: record.merchantRequestId, CheckoutRequestID: record.checkoutRequestId, ResultCode: code, ResultDesc: desc, ...meta } } };
    const responses = [];
    for (let i = 0; i < times; i++) {
      const r = await fetch(record.callbackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      responses.push({ status: r.status, body: await r.json().catch(() => null) });
    }
    return responses;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "GET" && url.pathname === "/oauth/v1/generate") {
      const expected = `Basic ${Buffer.from(`${TEST_CREDENTIALS.key}:${TEST_CREDENTIALS.secret}`).toString("base64")}`;
      if (req.headers.authorization !== expected) return json(res, 400, { errorCode: "400.008.01", errorMessage: "Invalid Authentication passed" });
      return json(res, 200, { access_token: token, expires_in: "3599" });
    }

    if (req.method === "POST" && url.pathname === "/mpesa/stkpush/v1/processrequest") {
      if (!authorised(req)) return json(res, 401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" });
      const b = await readBody(req);
      if (b.BusinessShortCode !== TEST_CREDENTIALS.shortcode || b.Password !== expectedPassword(b.Timestamp)) return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid Password" });
      if (!/^254[17]\d{8}$/.test(String(b.PhoneNumber))) return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" });
      if (!Number.isInteger(b.Amount) || b.Amount < 1) return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid Amount" });
      if (String(b.AccountReference).length > 12) return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid AccountReference" });
      const record = {
        checkoutRequestId: `ws_CO_${Date.now()}${Math.floor(Math.random() * 1e6)}`,
        merchantRequestId: `${Math.floor(Math.random() * 1e5)}-${Math.floor(Math.random() * 1e8)}-1`,
        amount: b.Amount,
        phone: b.PhoneNumber,
        callbackUrl: b.CallBackURL,
        accountReference: b.AccountReference,
        result: "pending",
        receipt: `T${Math.random().toString(36).slice(2, 11).toUpperCase()}`,
      };
      requests.set(record.checkoutRequestId, record);
      return json(res, 200, { MerchantRequestID: record.merchantRequestId, CheckoutRequestID: record.checkoutRequestId, ResponseCode: "0", ResponseDescription: "Success. Request accepted for processing", CustomerMessage: "Success. Request accepted for processing" });
    }

    if (req.method === "POST" && url.pathname === "/mpesa/stkpushquery/v1/query") {
      if (!authorised(req)) return json(res, 401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" });
      const b = await readBody(req);
      if (b.Password !== expectedPassword(b.Timestamp)) return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid Password" });
      const record = requests.get(b.CheckoutRequestID);
      if (!record) return json(res, 500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
      const queryResult = record.queryOverride ?? record.result;
      if (queryResult === "pending") return json(res, 500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
      const code = queryResult === "success" ? "0" : queryResult === "cancelled" ? "1032" : "2001";
      return json(res, 200, { ResponseCode: "0", ResponseDescription: "The service request has been accepted successsfully", MerchantRequestID: record.merchantRequestId, CheckoutRequestID: record.checkoutRequestId, ResultCode: code, ResultDesc: code === "0" ? "The service request is processed successfully." : "Request cancelled by user" });
    }

    // ── Test control API ──────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/__control/complete") {
      const b = await readBody(req);
      const record = b.checkoutRequestId ? requests.get(b.checkoutRequestId) : [...requests.values()].at(-1);
      if (!record) return json(res, 404, { error: "no request" });
      record.result = b.result ?? "success";
      if (b.queryOverride) record.queryOverride = b.queryOverride;
      if (b.paidAmount !== undefined) record.paidAmount = b.paidAmount;
      const responses = b.sendCallback === false ? [] : await deliver(record, b.times ?? 1);
      return json(res, 200, { record, responses });
    }
    if (req.method === "GET" && url.pathname === "/__control/requests") return json(res, 200, [...requests.values()]);

    json(res, 404, { error: "not found" });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, requests, port, close: () => new Promise((r) => server.close(r)) })));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("mock-daraja.mjs")) {
  const port = Number(process.env.MOCK_DARAJA_PORT ?? 4010);
  startMockDaraja(port).then(() => console.log(`Mock Daraja listening on http://127.0.0.1:${port}`));
}
