# Code signing with SignPath Foundation

This project is set up to use the free [SignPath Foundation](https://signpath.org/)
program for open-source software. This guide covers what is already done and the
steps only the maintainer can do.

## What signing will and will not do

Microsoft's own documentation
([SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
is clear that a signature does **not** make the warning disappear straight away:

- A signed installer still shows an "unrecognized app" prompt until it builds a
  track record — Microsoft says that can take several weeks and hundreds of clean
  installs.
- What signing does give you: the prompt shows a **verified publisher name**,
  reputation **carries over between versions** signed by the same identity, and
  Windows 11 **Smart App Control** no longer blocks the installer outright.
- With SignPath Foundation the publisher shown is **"SignPath Foundation"**, not
  your own name.

## Already done in this repository

| Requirement | Where |
|---|---|
| OSI-approved licence, no proprietary parts | MIT, see `LICENSE` |
| Public source repository | this repository |
| Already released in the form to be signed | GitHub Releases |
| Built from source in CI, origin verifiable | `.github/workflows/release.yml` |
| Consistent product name and version in the binary | `ComfyUI RunPod Launcher` / `package.json` version |
| Uninstaller, no hidden system changes | NSIS installer with uninstaller |
| "Code signing policy" section | README, section *Code signing policy* |
| Actions pinned to exact commits | the workflow |

The workflow already builds and tests on GitHub's runners. Signing switches on by
itself the moment the repository variable `SIGNPATH_ORGANIZATION_ID` exists.

## What you need to do

### 1. Turn on two-step login (required by SignPath)
Every team member needs multi-factor authentication on **GitHub** and on
**SignPath**. GitHub: *Settings → Password and authentication*.

### 2. Apply
Open <https://signpath.org/apply.html> and apply for the project. Have these ready:

- Repository: <https://github.com/BISAM20/comfyui-runpod-launcher>
- Licence: MIT
- Download page: <https://github.com/BISAM20/comfyui-runpod-launcher/releases/latest>
- Code signing policy: the *Code signing policy* section of the README

I could not read the form itself (it needs a browser), so check what it asks for.
SignPath does not publish how long a review takes, and acceptance is at their
discretion.

### 3. After you are accepted
SignPath will give you an **organization ID**, a **project slug** and a **signing
policy slug**. In the SignPath project:

1. Link the project to the predefined **GitHub.com** trusted build system.
2. Save this **artifact configuration** (SignPath's editor validates the XML;
   the `product-name` / `product-version` check is what their terms require):

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <parameters>
       <parameter name="version" required="true" />
     </parameters>
     <zip-file>
       <pe-file path="ComfyUI RunPod Launcher Setup ${version}.exe"
                product-name="ComfyUI RunPod Launcher"
                product-version="${version}">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   SignPath's documentation shows `product-name` / `product-version` on a root
   `<pe-file>` and does not say whether they are accepted on one nested inside a
   `<zip-file>`. If the editor rejects them there, ask SignPath support how to
   enforce the metadata for a zipped single file.

3. Create an **API token** for a user with *submitter* permission on the signing
   policy.

### 4. Tell GitHub
Repository → *Settings → Secrets and variables → Actions*:

| Kind | Name | Value |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | the API token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | your organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | the project slug |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | the signing policy slug |

### 5. Update the README
In the *Code signing policy* section, replace the "not yet signed" status line
with the signed wording, and update the SmartScreen note in *Download*.

## Releasing from now on

Releases come from CI, because the signature has to vouch for a verifiable build.

1. Bump `version` in `package.json` and the README badge; add the README *Version
   history* entry; write `RELEASE_NOTES_vX.Y.Z.md`.
2. Commit and push to `main`.
3. Tag and push the tag:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. The workflow builds, runs the tests, submits the installer to SignPath, and —
   once you **approve the signing request in SignPath** (every release needs
   manual approval) — publishes the GitHub release with the signed installer.

Notes:
- The tag must equal `v` + the `package.json` version, or the workflow stops.
- **To test the build without releasing**, use *Actions → Release → Run workflow*.
  It builds and tests, uploads the installer as a downloadable artifact, and never
  publishes.
- If signing is configured and fails, **nothing is published** — the workflow never
  falls back to an unsigned release by itself.
- Releases are created with the tag as the title and `RELEASE_NOTES_vX.Y.Z.md` as
  the body; rename the title on GitHub if you like.
- Local builds (`Build Installer.bat`) still work and stay unsigned. Do not publish
  those once signing is on.

## Check a signed installer

```powershell
Get-AuthenticodeSignature ".\ComfyUI RunPod Launcher Setup 1.5.0.exe" | Format-List Status, SignerCertificate
```
`Status` should be `Valid` and the signer should be SignPath Foundation. Or
right-click the file → *Properties → Digital Signatures*.

## Known gap

Only the **installer** is signed. The program it installs
(`ComfyUI RunPod Launcher.exe`, a renamed Electron executable) is not. SmartScreen
looks at the downloaded installer, so the download prompt is covered, but a
Windows 11 machine running Smart App Control may still object to the unsigned
program after install. Signing it too means signing the unpacked app before the
installer is built — worth doing, but it needs SignPath's agreement on which files
are "own binaries", so ask them once you are accepted.
