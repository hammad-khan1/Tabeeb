"""
Deploys the classifier to a HuggingFace Space (free CPU tier).

Spaces builds the Docker image remotely, so no local Docker is needed. The Space is
created private by default: it receives patients' X-rays, so it should not be a public
endpoint anyone can send images to, and the AUTH_TOKEN secret is set on top of that.

Usage:
    HF_TOKEN=hf_xxx python deploy_space.py [--name tabeeb-xray] [--public]

The token needs *write* permission and comes from
https://huggingface.co/settings/tokens
"""

import argparse
import os
import secrets
import sys
from pathlib import Path

from huggingface_hub import HfApi

SPACE_DIR = Path(__file__).parent / "space"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="tabeeb-xray", help="Space name")
    parser.add_argument(
        "--public",
        action="store_true",
        help="Make the Space public. Not recommended: it processes medical images.",
    )
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        print("HF_TOKEN is not set. Create a write token at "
              "https://huggingface.co/settings/tokens", file=sys.stderr)
        return 1

    api = HfApi(token=token)

    try:
        user = api.whoami()["name"]
    except Exception as exc:
        print(f"Could not authenticate with HuggingFace: {exc}", file=sys.stderr)
        return 1

    repo_id = f"{user}/{args.name}"
    print(f"deploying to {repo_id} ({'public' if args.public else 'private'})")

    api.create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk="docker",
        private=not args.public,
        exist_ok=True,
    )

    # A shared secret so the endpoint is not open even if the Space is made public.
    auth_token = os.environ.get("SPACE_AUTH_TOKEN") or secrets.token_urlsafe(24)
    api.add_space_secret(repo_id=repo_id, key="AUTH_TOKEN", value=auth_token)

    api.upload_folder(
        repo_id=repo_id,
        repo_type="space",
        folder_path=str(SPACE_DIR),
        commit_message="Deploy Tabeeb X-ray classifier",
    )

    url = f"https://huggingface.co/spaces/{repo_id}"
    endpoint = f"https://{user.lower()}-{args.name.lower()}.hf.space/"

    print("\ndeployed. the first build takes several minutes (it bakes the weights in).")
    print(f"  build logs:  {url}")
    print("\nadd these to .env.local:")
    print(f"  RADIOLOGY_CLASSIFIER_URL={endpoint}")
    print(f"  HF_API_KEY={auth_token}")
    print("\n  (HF_API_KEY is what Tabeeb sends as the bearer token; it must match the")
    print("   Space's AUTH_TOKEN secret, which this script just set.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
