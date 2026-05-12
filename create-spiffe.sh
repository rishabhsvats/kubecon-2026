#!/bin/bash -e

echo "------------------------------------"
echo "Preparing SPIRE bundle TLS cert/key"
echo "------------------------------------"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 \
  -nodes \
  -keyout "$TMP_DIR/tls.key" \
  -out "$TMP_DIR/tls.crt" \
  -subj "/CN=spire-server.default.svc.cluster.local" \
  -addext "subjectAltName=DNS:spire-server.default.svc.cluster.local,DNS:spire-server.default.svc,DNS:spire-server,DNS:localhost,IP:127.0.0.1"

kubectl create secret generic spire-bundle-tls \
  --from-file=tls.crt="$TMP_DIR/tls.crt" \
  --from-file=tls.key="$TMP_DIR/tls.key" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "--------------------------"
echo "Deploying SPIRE server..."
echo "--------------------------"

kubectl apply -f spiffe-server.yaml
kubectl rollout restart deployment/spire-server
kubectl rollout status deployment/spire-server --timeout=120s

echo "--------------------------------------------------------------"
echo "Restarting Keycloak after SPIRE cert refresh and server reload"
echo "--------------------------------------------------------------"

kubectl rollout restart statefulset/keycloak
kubectl rollout status statefulset/keycloak --timeout=180s

echo "--------------------------------------------"
echo "Creating SPIRE agent join token in secret..."
echo "--------------------------------------------"

JOIN_TOKEN=$(kubectl exec deploy/spire-server -- /opt/spire/bin/spire-server token generate -spiffeID spiffe://example.org/spire-agent | awk '/Token:/ {print $2}')

if [ -z "$JOIN_TOKEN" ]; then
  echo "Unable to create SPIRE join token"
  exit 1
fi

kubectl create secret generic spire-agent-join-token \
  --from-literal=token="$JOIN_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "-------------------------"
echo "Deploying SPIRE agent..."
echo "-------------------------"

kubectl delete daemonset spire-agent --ignore-not-found=true
kubectl apply -f spiffe-agent.yaml
kubectl rollout restart deployment/spire-agent
kubectl rollout status deployment/spire-agent --timeout=180s

echo "-------------------------------------------------------------------"
echo "Registering SPIFFE ID for workload (unix uid:0 and unix uid:1000)..."
echo "-------------------------------------------------------------------"

kubectl exec deploy/spire-server -- /opt/spire/bin/spire-server entry create \
  -parentID spiffe://example.org/spire-agent \
  -spiffeID spiffe://example.org/myclient \
  -selector unix:uid:0

kubectl exec deploy/spire-server -- /opt/spire/bin/spire-server entry create \
  -parentID spiffe://example.org/spire-agent \
  -spiffeID spiffe://example.org/myclient \
  -selector unix:uid:1000

echo "SPIRE is ready. Workloads can fetch JWT-SVID from /run/spire/sockets/agent.sock."
