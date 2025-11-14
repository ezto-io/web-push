const getCameraAccess = async (facingMode = "user", includeAudio = true) => {
  try {
    // Validate facingMode parameter
    const validFacingModes = ["user", "environment", "left", "right"];
    if (!validFacingModes.includes(facingMode)) {
      throw new Error(
        `Invalid facingMode: ${facingMode}. Must be one of: ${validFacingModes.join(
          ", "
        )}`
      );
    }

    // Check if running in secure context (HTTPS or localhost)
    if (
      location.protocol !== "https:" &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    ) {
      throw new Error("Camera access requires HTTPS or localhost");
    }

    // Check if mediaDevices is supported
    if (!navigator.mediaDevices) {
      // Fallback for older browsers
      return await getLegacyUserMedia(facingMode, includeAudio);
    }

    // Check if getUserMedia is supported
    if (!navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia is not supported in this browser");
    }

    // Prepare constraints with fallbacks
    const constraints = {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
      },
      audio: includeAudio,
    };

    // Try with ideal facingMode first
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (error) {
      // If facingMode fails, try without it (especially for desktop)
      if (
        error.name === "OverconstrainedError" ||
        error.name === "ConstraintNotSatisfiedError"
      ) {
        console.warn(
          "Specific facingMode not available, trying without constraint"
        );

        const fallbackConstraints = {
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: includeAudio,
        };

        return await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      }
      throw error;
    }
  } catch (error) {
    // Handle different types of errors with user-friendly messages
    throw getErrorMessage(error);
  }
};

// Legacy support for older browsers
const getLegacyUserMedia = (facingMode, includeAudio) => {
  return new Promise((resolve, reject) => {
    // Get the legacy getUserMedia function
    const getUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia;

    if (!getUserMedia) {
      reject(new Error("getUserMedia is not supported in this browser"));
      return;
    }

    const constraints = {
      video: {
        facingMode: facingMode,
      },
      audio: includeAudio,
    };

    getUserMedia.call(navigator, constraints, resolve, reject);
  });
};

// Error message helper
const getErrorMessage = (error) => {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      error.message =
        "Camera access denied. Please allow camera permissions and try again.";
      break;

    case "NotFoundError":
    case "DevicesNotFoundError":
      error.message = "No camera found. Please connect a camera and try again.";
      break;

    case "NotReadableError":
    case "TrackStartError":
      error.message = "Camera is already in use by another application.";
      break;

    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      error.message = "Camera does not support the requested configuration.";
      break;

    case "NotSupportedError":
      error.message = "Camera access is not supported in this browser.";
      break;

    case "AbortError":
      error.message = "Camera access was aborted.";
      break;

    case "SecurityError":
      error.message = "Camera access blocked due to security restrictions.";
      break;

    default:
      // Optionally, customize the default here
      if (!error.message) {
        error.message = "An unknown error occurred while accessing the camera.";
      }
      break;
  }
  return error;
};

// Helper function to check camera support
const isCameraSupported = () => {
  return !!(
    navigator.mediaDevices?.getUserMedia ||
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia
  );
};

// Usage examples:
export { getCameraAccess, isCameraSupported };

// Example usage:
/*
try {
  // Front camera with audio
  const stream = await getCameraAccess('user', true);
  
  // Back camera without audio
  const stream = await getCameraAccess('environment', false);
  
  // Check if camera is supported
  if (isCameraSupported()) {
    console.log('Camera is supported');
  }
  
} catch (error) {
  console.error('Camera access failed:', error.message);
  // Show user-friendly error message
  alert(error.message);
}
*/
