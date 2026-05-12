#!/bin/bash -e

APP_HOST=auth-demo.$(minikube ip).nip.io

echo "-----------------------"
echo "Login kcadm to Keycloak"
echo "-----------------------"

KC_POD=$(kubectl get pods | grep keycloak | cut -f 1 -d ' ')
KCADMIN="kubectl exec $KC_POD -- /opt/keycloak/bin/kcadm.sh"

$KCADMIN config credentials --server http://localhost:8080 --realm master --user admin --password admin

echo "----------------------------"
echo "Create demo kubernetes realm"
echo "----------------------------"

$KCADMIN create realms -s realm=kubernetes -s enabled=true

echo "------------------------------------------"
echo "Create Kubernetes Identity Provider config"
echo "------------------------------------------"

$KCADMIN create identity-provider/instances -r kubernetes -s alias=kubernetes -s providerId=kubernetes -s config='{"issuer": "https://kubernetes.default.svc.cluster.local"}'

echo "--------------------------------------"
echo "Create SPIFFE Identity Provider config"
echo "--------------------------------------"

$KCADMIN create identity-provider/instances -r kubernetes \
  -s alias=spiffe \
  -s providerId=spiffe \
  -s config='{"trustDomain":"spiffe://example.org","bundleEndpoint":"https://spire-server.default.svc.cluster.local:8543"}'

#echo "------------------------------------------------------------"
#echo "Create client credentials client authenticated with Kubernetes service account"
#echo "------------------------------------------------------------"

#$KCADMIN create clients -r kubernetes -s clientId=myclient -s serviceAccountsEnabled=true -s clientAuthenticatorType=federated-jwt -s attributes='{ "jwt.credential.issuer": "kubernetes", "jwt.credential.sub": "system:serviceaccount:default:my-serviceaccount" }'

echo "-------------------------------------------------------------"
echo "Create auth code client authenticated with client secret"
echo "-------------------------------------------------------------"

$KCADMIN create clients -r kubernetes \
  -s clientId=web-secret-client \
  -s name="Web App - Client Secret" \
  -s enabled=true \
  -s standardFlowEnabled=true \
  -s serviceAccountsEnabled=true \
  -s publicClient=false \
  -s secret=demo-client-secret \
  -s redirectUris='["https://'"$APP_HOST"'/callback-secret"]'

echo "--------------------------------------------------------------------"
echo "Create auth code client authenticated with Kubernetes service account"
echo "--------------------------------------------------------------------"

$KCADMIN create clients -r kubernetes \
  -s clientId=web-k8s-client \
  -s name="Web App - Kubernetes Service Account Assertion" \
  -s enabled=true \
  -s standardFlowEnabled=true \
  -s serviceAccountsEnabled=true \
  -s publicClient=false \
  -s clientAuthenticatorType=federated-jwt \
  -s attributes='{ "jwt.credential.issuer": "kubernetes", "jwt.credential.sub": "system:serviceaccount:default:my-serviceaccount" }' \
  -s redirectUris='["https://'"$APP_HOST"'/callback-k8s"]'

echo "-------------------------------------------------------------------------"
echo "Create SPIFFE client for both client-credentials and auth-code grant flow"
echo "-------------------------------------------------------------------------"

$KCADMIN create clients -r kubernetes \
  -s clientId=spiffe-client \
  -s name="Web App - SPIFFE JWT-SVID Assertion" \
  -s enabled=true \
  -s standardFlowEnabled=true \
  -s serviceAccountsEnabled=true \
  -s publicClient=false \
  -s clientAuthenticatorType=federated-jwt \
  -s attributes='{ "jwt.credential.issuer": "spiffe", "jwt.credential.sub": "spiffe://example.org/myclient" }' \
  -s redirectUris='["https://'"$APP_HOST"'/callback-spiffe"]'
