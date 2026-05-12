#!/bin/bash -e

KEYCLOAK_HOST=keycloak.$(minikube ip).nip.io
APP_HOST=auth-demo.$(minikube ip).nip.io
AGENT_NODE_NAME=$(kubectl get pod -l app=spire-agent -o jsonpath='{.items[0].spec.nodeName}')

if [ -z "$AGENT_NODE_NAME" ]; then
  echo "Unable to determine SPIRE agent node. Deploy SPIRE agent first."
  exit 1
fi

kubectl create configmap auth-demo-app \
  --from-file=webapp/server.js \
  --from-file=webapp/public/index.html \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Recreating my-pod so updated spec is applied..."
kubectl delete pod my-pod --ignore-not-found=true --grace-period=0 --force

cat mypod.yaml | \
sed "s/KEYCLOAK_HOST/$KEYCLOAK_HOST/g; s/APP_HOST/$APP_HOST/g; s/AGENT_NODE_NAME/$AGENT_NODE_NAME/g" | \
kubectl apply -f -

echo "Demo app available on https://$APP_HOST"
