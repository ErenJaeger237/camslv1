"""
mjpeg.py — Lightweight MJPEG streaming server.

Replaces the Base64-over-IPC webcam display pattern.  Instead of encoding
each frame as Base64, compressing it into a JSON payload, and shipping it
through PyWebView's JS bridge 30 times per second (causing GC spikes and
IPC serialisation overhead), this module starts a tiny HTTP server that
speaks multipart/x-mixed-replace — the browser's native video streaming
format.

The JS side sets `<img src="http://127.0.0.1:{port}/stream">` exactly once;
the browser then handles all streaming internally with no string allocations
or GC pressure on the JS heap.

Thread safety
-------------
push_frame() is called from the capture thread.
Each connected browser tab is served by its own handler thread (via
ThreadingHTTPServer).  A threading.Condition serialises access to the shared
frame buffer and wakes all handlers when a new frame arrives.
"""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MjpegServer:
    """
    Serves a single MJPEG endpoint at  http://127.0.0.1:{port}/stream.

    Usage
    -----
        server = MjpegServer()          # binds on an OS-assigned free port
        server.push_frame(jpeg_bytes)   # called from the capture thread
        img.src = server.url            # set in JS once on startup
        server.stop()                   # called on app shutdown
    """

    def __init__(self) -> None:
        self._lock  = threading.Lock()
        self._cond  = threading.Condition(self._lock)
        self._frame: bytes = b""

        outer = self

        class _Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass  # suppress per-request access log noise

            def do_GET(self) -> None:
                if self.path != "/stream":
                    self.send_response(404)
                    self.end_headers()
                    return

                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "multipart/x-mixed-replace; boundary=frame",
                )
                self.send_header("Cache-Control", "no-cache")
                # Allow the file:// PyWebView page to fetch from localhost
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                try:
                    while True:
                        with outer._cond:
                            outer._cond.wait(timeout=1.0)
                            frame = outer._frame

                        if not frame:
                            continue

                        self.wfile.write(
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n\r\n"
                            + frame
                            + b"\r\n"
                        )
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass   # client disconnected (tab close / page refresh)

        # Port 0 → OS picks a free port; avoids hardcoded port conflicts
        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(
            target=self._httpd.serve_forever, daemon=True, name="mjpeg-server"
        ).start()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push_frame(self, jpeg_bytes: bytes) -> None:
        """Deliver a new JPEG frame to all connected clients."""
        with self._cond:
            self._frame = jpeg_bytes
            self._cond.notify_all()

    @property
    def url(self) -> str:
        """The full URL JS should use as the img src."""
        port = self._httpd.server_address[1]
        return f"http://127.0.0.1:{port}/stream"

    def stop(self) -> None:
        """Shut down the HTTP server (call from app shutdown)."""
        self._httpd.shutdown()
