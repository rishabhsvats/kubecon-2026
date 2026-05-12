const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URLSearchParams } = require("url");

const host = "0.0.0.0";
const port = Number(process.env.PORT || "8080");
const keycloakUrl = process.env.KEYCLOAK_URL || "https://keycloak.local";
const appUrl = process.env.APP_URL || "https://app.local";
const realm = process.env.REALM || "kubernetes";
const tokenPath = process.env.TOKEN_PATH || "/var/run/secrets/tokens/kctoken";
const k8sApiTokenPath = process.env.K8S_API_TOKEN_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/token";
const secretClientId = process.env.SECRET_CLIENT_ID || "web-secret-client";
const secretClientSecret = process.env.SECRET_CLIENT_SECRET || "demo-client-secret";
const secretClientCredentialsId = process.env.SECRET_CLIENT_CREDENTIALS_ID || secretClientId;
const k8sClientId = process.env.K8S_CODE_CLIENT_ID || "web-k8s-client";
const clientCredentialsId = process.env.CLIENT_CREDENTIALS_CLIENT_ID || "web-k8s-client";
const kubernetesIssuerUrl = process.env.KUBERNETES_ISSUER_URL || "https://kubernetes.default.svc.cluster.local";
const spiffeJwtSvidPath = process.env.SPIFFE_JWT_SVID_PATH || "/var/run/secrets/spiffe/jwt-svid.json";
const spiffeClientSpiffeId = process.env.SPIFFE_CLIENT_SPIFFE_ID || "spiffe://example.org/myclient";
const spiffeCodeClientId = process.env.SPIFFE_CODE_CLIENT_ID || "spiffe-client";

const staticRoot = __dirname;
const tokenEndpoint = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
const authorizationEndpoint = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth`;
const kubernetesWellKnownEndpoint = `${kubernetesIssuerUrl}/.well-known/openid-configuration`;
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

function readServiceAccountToken() {
  return fs.readFileSync(tokenPath, "utf8").trim();
}

function readKubernetesApiToken() {
  try {
    return fs.readFileSync(k8sApiTokenPath, "utf8").trim();
  } catch (_error) {
    return readServiceAccountToken();
  }
}

function readSpiffeJwtSvid() {
  const raw = fs.readFileSync(spiffeJwtSvidPath, "utf8").trim();
  if (raw.length === 0) {
    throw new Error("SPIFFE SVID file is empty");
  }

  const payload = JSON.parse(raw);
  const entries = Array.isArray(payload) ? payload : [payload];
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.svids)) {
      continue;
    }
    for (const svidEntry of entry.svids) {
      if (typeof svidEntry?.svid === "string" && svidEntry.svid.length > 0) {
        return svidEntry.svid;
      }
    }
  }

  throw new Error("No SPIFFE JWT-SVID found in payload");
}

async function requestToken(formData) {
  return new Promise((resolve, reject) => {
    const requestBody = { ...formData };
    const body = new URLSearchParams(formData).toString();
    const endpointUrl = new URL(tokenEndpoint);

    const request = https.request({
      protocol: endpointUrl.protocol,
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || 443,
      path: `${endpointUrl.pathname}${endpointUrl.search}`,
      method: "POST",
      agent: insecureAgent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = { error: "non_json_response", body: text };
        }
        resolve({
          status: response.statusCode || 500,
          body: parsed,
          tokenEndpointDump: {
            request: {
              method: "POST",
              url: tokenEndpoint,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: requestBody,
            },
            response: {
              status: response.statusCode || 500,
              body: parsed,
            },
          },
        });
      });
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const endpointUrl = new URL(url);
    const request = https.request({
      protocol: endpointUrl.protocol,
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || 443,
      path: `${endpointUrl.pathname}${endpointUrl.search}`,
      method: "GET",
      agent: insecureAgent,
      headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = { error: "non_json_response", body: text };
        }
        resolve({
          status: response.statusCode || 500,
          body: parsed,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function decodeJwtPayload(jwt) {
  if (typeof jwt !== "string") {
    throw new Error("jwt must be a string");
  }
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("jwt does not have two segments");
  }
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(decoded);
}

function sendJson(res, statusCode, payload) {
  const response = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(response),
  });
  res.end(response);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 500, { error: "cannot_read_static_file" });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  });
}

function withTokenDump(result) {
  return {
    ...result.body,
    tokenEndpointDump: result.tokenEndpointDump,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, {
      appUrl,
      keycloakUrl,
      realm,
      authorizationEndpoint,
      scenarios: {
        userAuthClientSecret: {
          clientId: secretClientId,
          callbackPath: "/callback-secret",
        },
        clientCredentialsK8sServiceAccount: {
          clientId: clientCredentialsId,
        },
        clientCredentialsClientSecret: {
          clientId: secretClientCredentialsId,
        },
        userAuthK8sServiceAccount: {
          clientId: k8sClientId,
          callbackPath: "/callback-k8s",
        },
        userAuthSpiffe: {
          clientId: spiffeCodeClientId,
          callbackPath: "/callback-spiffe",
        },
        clientCredentialsSpiffe: {
          spiffeId: spiffeClientSpiffeId,
        },
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/scenario-secrets") {
    try {
      const serviceAccountToken = readServiceAccountToken();
      let spiffeJwtSvid = null;
      let spiffeReadError = null;
      try {
        spiffeJwtSvid = readSpiffeJwtSvid();
      } catch (error) {
        spiffeReadError = error.message;
      }
      sendJson(res, 200, {
        scenario1: {
          clientId: secretClientId,
          clientSecret: secretClientSecret,
        },
        scenario2: {
          kubernetesServiceAccountToken: serviceAccountToken,
        },
        scenario3: {
          clientId: k8sClientId,
          kubernetesServiceAccountToken: serviceAccountToken,
        },
        scenario4: {
          clientId: secretClientCredentialsId,
          clientSecret: secretClientSecret,
        },
        scenario6: {
          spiffeId: spiffeClientSpiffeId,
          spiffeJwtSvid,
          spiffeReadError,
        },
        scenario7: {
          clientId: spiffeCodeClientId,
          spiffeId: spiffeClientSpiffeId,
          spiffeJwtSvid,
          spiffeReadError,
        },
      });
    } catch (error) {
      sendJson(res, 500, { error: "cannot_read_scenario_secrets", details: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/k8s-well-known") {
    try {
      const kubernetesApiToken = readKubernetesApiToken();
      const decodedServiceAccountJwt = decodeJwtPayload(kubernetesApiToken);
      const result = await requestJson(kubernetesWellKnownEndpoint, {
        Authorization: `Bearer ${kubernetesApiToken}`,
        Accept: "application/json",
      });
      sendJson(res, result.status, {
        endpoint: kubernetesWellKnownEndpoint,
        wellKnownResponse: result.body,
        decodedServiceAccountJwt,
      });
    } catch (error) {
      sendJson(res, 500, { error: "cannot_load_k8s_well_known", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/client-secret") {
    try {
      const body = await readBody(req);
      const result = await requestToken({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: body.redirectUri,
        client_id: secretClientId,
        client_secret: secretClientSecret,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 400, { error: "invalid_request_body", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/client-credentials-k8s") {
    try {
      const serviceAccountToken = readServiceAccountToken();
      const result = await requestToken({
        grant_type: "client_credentials",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: serviceAccountToken,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 500, { error: "cannot_use_service_account_token", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/client-credentials-secret") {
    try {
      const result = await requestToken({
        grant_type: "client_credentials",
        client_id: secretClientCredentialsId,
        client_secret: secretClientSecret,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 500, { error: "cannot_use_client_secret", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/client-credentials-spiffe") {
    try {
      const spiffeJwtSvid = readSpiffeJwtSvid();
      const result = await requestToken({
        grant_type: "client_credentials",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-spiffe",
        client_assertion: spiffeJwtSvid,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 500, { error: "cannot_use_spiffe_jwt_svid", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/k8s-authcode") {
    try {
      const body = await readBody(req);
      const serviceAccountToken = readServiceAccountToken();
      const result = await requestToken({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: body.redirectUri,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: serviceAccountToken,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 500, { error: "cannot_exchange_auth_code", details: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/token/spiffe-authcode") {
    try {
      const body = await readBody(req);
      const spiffeJwtSvid = readSpiffeJwtSvid();
      const result = await requestToken({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: body.redirectUri,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-spiffe",
        client_assertion: spiffeJwtSvid,
      });
      sendJson(res, result.status, withTokenDump(result));
    } catch (error) {
      sendJson(res, 500, { error: "cannot_exchange_auth_code_spiffe", details: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "api_route_not_found" });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, appUrl);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  const indexPath = path.join(staticRoot, "index.html");
  if (
    pathname === "/" ||
    pathname === "/callback-secret" ||
    pathname === "/callback-k8s" ||
    pathname === "/callback-spiffe"
  ) {
    sendFile(res, indexPath);
    return;
  }

  sendJson(res, 404, { error: "route_not_found" });
});

server.listen(port, host, () => {
  console.log(`Demo app listening on ${host}:${port}`);
});
