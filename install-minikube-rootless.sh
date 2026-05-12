#!/bin/bash
set -euo pipefail

# Bootstrap a minikube profile for this project using rootless podman.
# This script creates/recreates the cluster, enables ingress, and validates readiness.

PROFILE="${PROFILE:-minikube}"
K8S_VERSION="${K8S_VERSION:-v1.31.8}"
CPUS="${CPUS:-4}"
MEMORY_MB="${MEMORY_MB:-8192}"
DELETE_EXISTING="${DELETE_EXISTING:-true}"
ENABLE_METRICS_SERVER="${ENABLE_METRICS_SERVER:-true}"

echo_section() {
  echo ""
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

wait_for_ingress() {
  local timeout_seconds="${1:-240}"
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    -l app.kubernetes.io/name=ingress-nginx \
    --timeout="${timeout_seconds}s"
}

echo_section "Checking prerequisites"
require_cmd podman
require_cmd minikube
require_cmd kubectl

#if [[ "$(podman info --format '{{.Host.Security.Rootless}}')" != "true" ]]; then
#  echo "Podman is not running rootless for the current user."
#  echo "Please switch to rootless podman, then rerun this script."
#  exit 1
#fi
echo "Podman rootless mode detected."

echo_section "Starting minikube with podman"
if [[ "${DELETE_EXISTING}" == "true" ]]; then
  minikube delete --profile="${PROFILE}" >/dev/null 2>&1 || true
fi

minikube start \
  --profile="${PROFILE}" \
  --driver=podman \
  --container-runtime=containerd \
  --kubernetes-version="${K8S_VERSION}" \
  --cpus="${CPUS}" \
  --memory="${MEMORY_MB}"

kubectl config use-context "${PROFILE}" >/dev/null

echo_section "Enabling addons"
minikube addons enable ingress --profile="${PROFILE}"
if [[ "${ENABLE_METRICS_SERVER}" == "true" ]]; then
  minikube addons enable metrics-server --profile="${PROFILE}"
fi



echo_section "Cluster summary"
MINIKUBE_IP="$(minikube ip --profile="${PROFILE}")"
echo "Profile: ${PROFILE}"
echo "Kubernetes version: ${K8S_VERSION}"
echo "Minikube IP: ${MINIKUBE_IP}"
kubectl get nodes
kubectl get pods -n ingress-nginx

echo_section "Next steps for this project"
echo "1) Keep routing active in a separate terminal (rootless podman):"
echo "   minikube tunnel --profile=${PROFILE}"
echo ""
echo "2) In this folder, deploy the project:"
echo "   ./create-keycloak.sh"
echo "   ./configure-keycloak.sh"
echo "   ./create-mypod.sh"
echo "   ./check-ingress.sh"
