#!/bin/bash
set -euo pipefail

MINIKUBE_IP=$(minikube ip)
KEYCLOAK_HOST="keycloak.${MINIKUBE_IP}.nip.io"
APP_HOST="auth-demo.${MINIKUBE_IP}.nip.io"

print_header() {
  echo ""
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

check_url() {
  local host="$1"
  local status
  status=$(curl -ksS -o /dev/null -w "%{http_code}" "https://${host}/" || true)
  if [[ "${status}" =~ ^(200|302|303)$ ]]; then
    echo "OK  https://${host}  (HTTP ${status})"
    return 0
  fi

  echo "FAIL https://${host}  (HTTP ${status})"
  return 1
}

print_header "Checking prerequisites"
check_cmd minikube
check_cmd kubectl
check_cmd curl

print_header "Checking minikube and ingress addon"
if ! minikube status >/dev/null 2>&1; then
  echo "Minikube is not running."
  echo "Start with: minikube start --driver=podman --container-runtime=containerd"
  exit 1
fi

if ! minikube addons list | grep -E '^\|\s*ingress\s*\|\s*minikube\s*\|\s*enabled\s*\|' >/dev/null 2>&1; then
  echo "Ingress addon is not enabled."
  echo "Enable with: minikube addons enable ingress"
  exit 1
fi
echo "Ingress addon is enabled."

print_header "Checking Kubernetes resources"
kubectl get ingress keycloak >/dev/null 2>&1 || {
  echo "Ingress 'keycloak' not found. Run ./create-keycloak.sh first."
  exit 1
}
kubectl get ingress auth-demo-app >/dev/null 2>&1 || {
  echo "Ingress 'auth-demo-app' not found. Run ./create-mypod.sh first."
  exit 1
}
echo "Required ingress resources found."

print_header "Checking external reachability over HTTPS"
FAILURES=0
check_url "${KEYCLOAK_HOST}" || FAILURES=$((FAILURES + 1))
check_url "${APP_HOST}" || FAILURES=$((FAILURES + 1))

if [[ ${FAILURES} -gt 0 ]]; then
  print_header "Reachability check failed"
  echo "For rootless podman setups, keep this running in another terminal:"
  echo "  minikube tunnel"
  echo ""
  echo "Then rerun:"
  echo "  ./check-ingress.sh"
  exit 1
fi

print_header "All checks passed"
echo "Ingress endpoints are reachable:"
echo "  https://${KEYCLOAK_HOST}"
echo "  https://${APP_HOST}"
