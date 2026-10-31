import { getOsuConfig } from "../src/config.js";

const config = getOsuConfig();
if (!config) {
  console.error("no osu config");
  process.exit(1);
}

const attempts = [
  { label: "no extra headers", headers: {} },
  { label: "Origin: http://localhost", headers: { Origin: "http://localhost" } },
  { label: "Referer: http://localhost", headers: { Referer: "http://localhost" } },
  { label: "Origin+Referer: http://localhost", headers: { Origin: "http://localhost", Referer: "http://localhost" } }
];

for (const attempt of attempts) {
  const res = await fetch("https://osu.ppy.sh/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...attempt.headers
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: "public"
    })
  });
  console.log(attempt.label, "->", res.status, await res.text());
}
