# Aethelguard Guard (Chrome)

This Manifest V3 extension checks public HTTP(S) URLs against existing
VirusTotal reports and scans completed downloads by SHA-256. It does not submit
unknown URLs or upload downloaded file contents. URL query strings and
fragments are removed before lookup, and localhost/private-network addresses
are skipped.

For download scans, a Windows native host reads completed files from the
Windows Downloads folder, computes their SHA-256 locally, and moves files to
`%LOCALAPPDATA%\Aethelguard\Quarantine` when at least one VirusTotal engine
classifies the file as malicious. It verifies the hash again before moving and
checks the copied file. The extension reports the score, malicious/suspicious
engine counts, and a few detection names in a Chrome notification.

Completed downloads also get a VirusTotal reputation lookup for the final
download domain. Only the domain is sent for this check; the URL path and query
string are not. A domain reputation is an additional signal, not proof that a
file is safe or malicious, and does not change the existing file-hash
quarantine rules. Unknown domain reports do not trigger automatic quarantine.

Suspicious-only files are warned about but not automatically moved. If
VirusTotal has no report, the file is left in Downloads and reported as
unrated; this does not mean that the file is safe. A VirusTotal lookup sends
the file hash to VirusTotal and sends the file name/hash to the Aethelguard
server. File contents remain on the computer.

## Configure and install locally

1. Set `VIRUSTOTAL_API_KEY` in the Aethelguard app's `.env.local`, then start or
   restart the Next.js app.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load
   unpacked**. Select the extracted extension folder containing `manifest.json`
   (or this `chrome-extension` folder when installing from the project). Copy
   the extension ID shown on its card.
3. From the extracted extension folder (or the project folder when installing
   from the repository), open PowerShell and run the matching command:
   ```powershell
   # Downloaded ZIP
   powershell -ExecutionPolicy Bypass -File .\Install-NativeHost.ps1

   # Project repository
   powershell -ExecutionPolicy Bypass -File .\chrome-extension\Install-NativeHost.ps1
   ```
   Enter the extension ID when prompted. The installer builds a small
   Windows-only native helper and registers it for the current Windows user;
   administrator access is not required. Reload the extension in Chrome.
4. The extension connects to the hosted Aethelguard app at
   `https://www.aethelguard.xyz` and automatically gets the app's public
   Supabase URL and publishable/anon key. The site must be deployed and its
   domain configured before connecting. It does not ask each user to enter
   those values. The service-role key and VirusTotal key stay server-side.
5. Open the extension popup and sign in once with an existing Supabase
   email/password account that has a profile. The extension keeps the refresh
   token in Chrome storage and refreshes its access token as needed; it does not
   ask for the password again unless the session expires or is signed out.
   Turning URL checks off in the popup does not sign out or stop download
   scanning; the account session is still needed for file reputation checks and
   auto-quarantine. **Sign out and stop download scanning** removes the saved
   session and stops both features until the user signs in again.
6. Grant the extension site access when Chrome asks. Its download and
   notification permissions are used to process completed downloads and show
   the result.
7. To have protection resume when you turn on the PC, enable Google Chrome in
   **Windows Settings → Apps → Startup** (or place a Chrome shortcut in the
   Windows Startup folder). Chrome starts its installed extensions with the
   browser after your Windows account signs in.

URL reputation checks use the hosted API. Completed-download hash scanning
also requires the Windows native host installed in step 3 and only scans files
inside the current user's Downloads folder. If the extension is reinstalled
with a different ID, rerun the installer with the new ID.

URL reports show the number of VirusTotal scanners that flagged the URL as
malicious or suspicious rather than a normalized score. On malicious or
suspicious reports, the banner offers **Go back to safety**. Unknown URLs are
labelled unrated. Private and local URLs are skipped.

To remove the Windows helper, run:

```powershell
# Downloaded ZIP
powershell -ExecutionPolicy Bypass -File .\Install-NativeHost.ps1 -Uninstall

# Project repository
powershell -ExecutionPolicy Bypass -File .\chrome-extension\Install-NativeHost.ps1 -Uninstall
```

Uninstalling removes the Chrome native-host registration and executable. It
does not delete quarantined files.

Quarantined files remain under `%LOCALAPPDATA%\Aethelguard\Quarantine` with
`.aethelguard-quarantined` appended to their names. They are not automatically
restored. Only restore a file if you have independently confirmed that it is
safe.
