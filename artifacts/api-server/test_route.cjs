const jwt = require("jsonwebtoken");

const JWT_SECRET = "astrosentinel-dev-secret";

async function test() {
  const token = jwt.sign({ userId: "00000000-0000-0000-0000-000000000000", email: "test@example.com", role: "user" }, JWT_SECRET);
  try {
    const res = await fetch("http://127.0.0.1:8000/api/notifications/preferences", {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
}
test();
