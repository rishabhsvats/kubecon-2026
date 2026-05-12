
if minikube status >/dev/null 2>&1; then
  echo "Minikube is already running."
else
  minikube start --driver=podman --force
  minikube addons enable ingress
fi

echo "Waiting for ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=Available deployment/ingress-nginx-controller \
  --timeout=120s
