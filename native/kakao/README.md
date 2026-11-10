# PotPlayer Kakao credential helper

This optional Windows native messaging helper imports the credential when PotPlayer actually sends a translation request. It observes Windows WinINet and WinHTTP calls for the Kakao translation endpoint, without fixed DLL offsets. Compatibility depends on the networking implementation used by the installed PotPlayer version. The helper must be registered for the specific browser extension ID. Python 3.11+ with Frida is required. The default Kakao credential is already in the extension; this helper is for replacing it.

Capture protocol 2 keeps process selection, endpoint/header matching policy, the two-minute waiting period and credential parsing in the extension. The helper provides unfiltered process enumeration and a fixed, bounded header-observation operation using the extension's explicit PID and declarative filter. It verifies the browser-supplied extension origin against its local manifest. Older helpers must be reinstalled with the updated source and launcher; the extension reports **Helper update required** and does not fall back to the former application-specific capture operation.

1. Install Python 3.11+ and the `frida` package in the Python environment you choose.
2. Find the unpacked extension ID on the browser extensions page, and locate that environment's `python.exe`.
3. Run in PowerShell, substituting the actual extension ID and Python path:

   `./native/kakao/install.ps1 -ExtensionId <extension-id> -PythonPath <path-to-python.exe>`

4. Reload the extension after accepting the native messaging permission. Open one 64-bit PotPlayer instance. In the subtitle translation settings choose Kakao, click **Import from PotPlayer**, and trigger subtitle translation in PotPlayer within two minutes.

The installer registers a per-user native messaging host for Chrome and Edge. The credential is sent to the extension through native messaging and is not written to a helper log. The browser stores it in extension-local storage. To uninstall the helper, remove the `com.mdownloader.kakao` registry entry under the current user's `Software\Google\Chrome\NativeMessagingHosts` and `Software\Microsoft\Edge\NativeMessagingHosts` keys. This helper has not been validated against a live PotPlayer session in this implementation.
