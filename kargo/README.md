# Kargo Dev/Prod Pipeline — Worthly

Two-environment deployment pipeline using Kargo + Argo CD.

## Architecture

```
GitHub Actions (push to main)
    │
    ▼
ghcr.io/kbdevops/worthly:sha-xxx
    │
    ▼
Kargo Warehouse (subscribes to image repo)
    │
    ▼
Kargo Stage: dev ─── auto-promotes ──► Argo CD App: worthly-dev
    │                                       │
    │ (manual promotion)                     ▼
    ▼                                  dev.worthly.internal
Kargo Stage: prod ── manual promote ─► Argo CD App: worthly-prod
                                           │
                                           ▼
                                      worthly.internal
```

## Directory Structure

```
kargo/
├── README.md                    # This file
├── namespace.yaml               # Kargo namespace (already applied)
├── project.yaml                 # Kargo project (already applied)
├── warehouse.yaml               # Image subscription — ghcr.io/kbdevops/worthly
├── stage-dev.yaml               # Dev stage (auto-promote)
├── stage-prod.yaml              # Prod stage (manual promote)
├── ghcr-secret.yaml             # GHCR image pull secret (needs your token)
├── argocd/
│   ├── app-worthly-dev.yaml     # Argo CD Application for dev
│   └── app-worthly-prod.yaml    # Argo CD Application for prod
└── homelab/
    ├── worthly-dev/             # Manifests for dev environment
    │   ├── kustomization.yaml
    │   ├── namespace.yaml
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   └── ingressroute.yaml
    └── worthly-prod/            # Manifests for prod environment
        ├── kustomization.yaml
        ├── namespace.yaml
        ├── deployment.yaml
        ├── service.yaml
        └── ingressroute.yaml
```

## Current Status

| Component | Status |
|---|---|
| Kargo controller | ✅ Running (5 pods in `kargo` namespace) |
| Kargo Project | ✅ Ready (named `kargo`) |
| Kargo Warehouse | ❌ Needs GHCR credentials |
| Kargo Stage: dev | ✅ Created (waiting for freight) |
| Kargo Stage: prod | ✅ Created (waiting for freight) |
| Argo CD App: worthly-dev | ⚠️ Waiting for homelab manifests |
| Argo CD App: worthly-prod | ⚠️ Waiting for homelab manifests |

## Remaining Setup Steps

### Step 1: Create GHCR image pull secret

The warehouse needs credentials to list tags on `ghcr.io/kbdevops/worthly`.

**Create a GitHub PAT** at https://github.com/settings/tokens with `read:packages` scope.

Then create the secret:

```bash
kubectl create secret docker-registry ghcr-creds \
  --namespace=kargo \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<your-github-token>

# Label it so Kargo finds it
kubectl label secret ghcr-creds -n kargo kargo.akuity.io/cred=true
```

### Step 2: Copy homelab manifests

Copy the environment directories to the `kbdevops/homelab-k8s` repo:

```bash
# In the homelab-k8s repo:
cp -r kargo/homelab/worthly-dev base/worthly-dev
cp -r kargo/homelab/worthly-prod base/worthly-prod

# Commit and push
git add base/worthly-dev base/worthly-prod
git commit -m "Add worthly dev/prod environments for Kargo"
git push
```

### Step 3: Remove old worthly from ApplicationSet

Edit the `homelab-apps` ApplicationSet in the homelab repo to remove the `worthly` entry:

```yaml
# Remove this element from the list:
# - app: worthly
#   namespace: worthly
```

Then delete the old Application:

```bash
kubectl delete application worthly -n argocd
```

### Step 4: Create hostPath directories

```bash
mkdir -p /home/obiwan/k8s_data/worthly-dev
# /home/obiwan/k8s_data/worthly already exists for prod
```

### Step 5: Verify everything works

```bash
# Check Kargo resources
kubectl get project,warehouse,stages -n kargo

# Check Argo CD apps
kubectl get applications -n argocd | grep worthly

# Check warehouse can discover images
kubectl describe warehouse worthly -n kargo | grep -A5 'Status:'
```

## Daily Workflow

### New code is pushed

1. Push to `main` → GitHub Actions builds and pushes to `ghcr.io/kbdevops/worthly:<sha>`
2. Kargo Warehouse discovers the new image → creates **Freight**
3. **Dev stage** auto-promotes → Argo CD syncs `worthly-dev` → `dev.worthly.internal` is updated
4. Verify the dev deployment at `https://dev.worthly.internal`

### Promoting to production

Create a Promotion resource to move verified freight from dev to prod:

```bash
kubectl apply -f - <<EOF
apiVersion: kargo.akuity.io/v1alpha1
kind: Promotion
metadata:
  name: prod-$(date +%s)
  namespace: kargo
spec:
  stage: prod
  freight: <freight-id>
EOF
```

To find the current freight ID:

```bash
kubectl get freight -n kargo
```

### Rollback

To roll back prod to a previous freight:

```bash
# Find the freight you want to revert to
kubectl get freight -n kargo --sort-by=.metadata.creationTimestamp

# Promote that specific freight to prod
kubectl apply -f - <<EOF
apiVersion: kargo.akuity.io/v1alpha1
kind: Promotion
metadata:
  name: prod-rollback-$(date +%s)
  namespace: kargo
spec:
  stage: prod
  freight: <older-freight-id>
EOF
```

## Configuration

| Setting | Dev | Prod |
|---|---|---|
| **Host** | `dev.worthly.internal` | `worthly.internal` |
| **Namespace** | `worthly-dev` | `worthly` |
| **hostPath** | `/home/obiwan/k8s_data/worthly-dev` | `/home/obiwan/k8s_data/worthly` |
| **Promotion** | Auto (on new image) | Manual |
| **Image** | `ghcr.io/kbdevops/worthly:<sha>` | `ghcr.io/kbdevops/worthly:<sha>` |

## Troubleshooting

### Warehouse shows UNAUTHORIZED

GHCR requires authentication even for listing tags. Create the secret as described in Step 1.

### Warehouse shows no freight

Check that images exist in GHCR with SHA tags:

```bash
kubectl describe warehouse worthly -n kargo
```

### Stage not promoting

```bash
kubectl describe stage dev -n kargo
kubectl describe stage prod -n kargo
```

### Argo CD app shows "app path does not exist"

The homelab repo directories haven't been created yet. Complete Step 2.

### Kargo API access

```bash
# Port forward to the Kargo API/UI
kubectl port-forward -n kargo svc/kargo-api 3000:443

# Open https://localhost:3000 (accept self-signed cert)
# Login with username: admin, password: admin123
```