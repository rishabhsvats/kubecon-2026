# Client Authentication with Kubernetes Service Accounts demo

## Prerequisites

* Linux
* Minikube with `ingress` addon enabled

## Bootstrap minikube for rootless podman

To provision a cluster that works with this demo:

* `chmod +x install-minikube-rootless.sh`
* `./install-minikube-rootless.sh`

The script:

* validates rootless podman
* recreates a minikube cluster using a stable Kubernetes version (`v1.31.8` by default)
* enables ingress and metrics-server
* retries ingress setup with single-node taint fallback if needed
* prints next steps, including running `minikube tunnel`

## Bootstrap minikube as root (rootful podman)

If you prefer running minikube as root:

* `chmod +x install-minikube-root.sh`
* `sudo ./install-minikube-root.sh`

This script provisions minikube with podman, enables ingress, waits for ingress readiness, and prints the project
deployment steps.

## Deploying Keycloak

To deploy Keycloak run `create-keycloak.sh`. This script will deploy a very basic instance of Keycloak with an
ingress so Keycloak can be accessed outside the cluster.

## Configuring Keycloak

The demo requires setting up a realm in Keycloak, with Kubernetes and SPIFFE identity providers, and clients configured
for the showcased scenarios.

This can be created by running `configure-keycloak.sh`.

## Deploy the demo application pod

Run `create-mypod.sh`.

This deploys:

* a service account (`my-serviceaccount`)
* a pod running a HTML/JavaScript demo application with a small Node.js backend
* a projected token mounted at `/var/run/secrets/tokens/kctoken`
* a sidecar that fetches a SPIFFE JWT-SVID from SPIRE and stores it at `/var/run/secrets/spiffe/jwt-svid.json`
* a service and ingress for the application

The projected token audience matches `https://KEYCLOAK_HOST/realms/kubernetes`, which is required when using
Kubernetes service accounts as client assertions.

## Deploy SPIRE components for SPIFFE

To enable the SPIFFE scenario in-cluster, deploy SPIRE Server and SPIRE Agent:

* `chmod +x create-spiffe.sh`
* `./create-spiffe.sh`

This script:

* creates a TLS cert for the SPIFFE bundle endpoint
* deploys SPIRE Server and SPIRE Agent in Kubernetes
* registers `spiffe://example.org/myclient` for the workload selector `unix:uid:0`
* exposes the SPIRE agent socket on `/run/spire/sockets/agent.sock` (mounted into the demo pod)

If Keycloak is already running, restart it so it picks up the SPIFFE bundle certificate mount:

* `kubectl rollout restart statefulset/keycloak`

## Demo scenarios

Open the app URL printed by `create-mypod.sh`:

* `https://auth-demo.<minikube ip>.nip.io`

The app demonstrates:

1. **User authentication + client secret**  
   Authorization code flow where token endpoint client authentication uses `client_secret`.
2. **Client credentials + Kubernetes service account**  
   Client credentials flow where token endpoint client authentication uses `client_assertion` from the projected
   Kubernetes service account token.
3. **User authentication + Kubernetes service account**  
   Authorization code flow where token endpoint client authentication uses `client_assertion` from the projected
   Kubernetes service account token.
4. **Client credentials + SPIFFE JWT-SVID**  
   Client credentials flow where token endpoint client authentication uses `client_assertion_type=jwt-spiffe` with
   a JWT-SVID minted by SPIRE for the workload.

## Notes

* Ingress uses HTTPS with a self-signed/default certificate in this demo setup. Open Keycloak in a browser once and
  accept the certificate warning before starting the scenarios.
* Client IDs created by `configure-keycloak.sh`:
  * `web-secret-client`
  * `myclient`
  * `web-k8s-client`
  * `spiffe-client`
* The demo client secret is `demo-client-secret` and is only used server-side inside the pod.

## Validate ingress reachability (rootless podman)

Before testing scenarios, run:

* `./check-ingress.sh`

If the check fails, start `minikube tunnel` in a separate terminal and run the check again.

## Try it out

The simplest way to try out if a client can authenticate with a Kubernetes service account is to do a client credential
grant, as this flow does not require a user to authenticate and can be done as a simple rest call.

Run the script `client-credential-grant.sh` this will grab the service account token and do a client credential grant
request to Keycloak.

## Presentation Materials

For presenting this demo, three documents are available:

* **`SLIDES.md`** - Minimal presentation deck (~20 slides) ready to copy into Google Slides or any presentation tool
  * Problem statement and motivation
  * Technical deep dive on federated JWT authentication
  * Architecture and demo walkthrough
  * Security best practices and roadmap
  
* **`SPEAKER_NOTES.md`** - Detailed speaker notes for each slide
  * Timing estimates (30-minute talk)
  * Key talking points and analogies
  * Live demo script
  * Q&A preparation with likely questions
  
* **`PRESENTATION_PROJECT_DOCUMENT.md`** - Comprehensive reference guide
  * Detailed explanations of all concepts
  * Full slide content with alternatives
  * Technical background and troubleshooting
  * References and further reading

**Recommended flow for presenters:**
1. Review `PRESENTATION_PROJECT_DOCUMENT.md` for deep understanding
2. Copy `SLIDES.md` content into your presentation template
3. Use `SPEAKER_NOTES.md` during practice and delivery
4. Run through the live demo scenarios 2-3 times before presenting