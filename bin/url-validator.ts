/**
 * Validates and normalizes URLs
 * Supports various input formats and ensures proper URL structure
 */

export interface UrlValidation {
  isValid: boolean;
  normalizedUrl: string;
  error?: string;
}

/**
 * Validates and normalizes a URL
 * Supports various input formats:
 * - Full URLs: https://example.com
 * - Protocol-less: example.com
 * - With trailing slash: example.com/
 * - With subdomain: sub.example.com
 */
export function validateUrl(urlString?: string): UrlValidation {
  // If no URL provided, return invalid
  if (!urlString || typeof urlString !== "string") {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "No URL provided",
    };
  }

  // Trim whitespace
  let url = urlString.trim();

  // Remove trailing slash if present
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }

  // If URL already has protocol, validate it directly
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsedUrl = new URL(url);

      // Validate it's a proper URL
      if (!parsedUrl.hostname || !parsedUrl.protocol) {
        return {
          isValid: false,
          normalizedUrl: "",
          error: "Invalid URL format",
        };
      }

      // Ensure it uses HTTPS
      const normalizedUrl =
        parsedUrl.protocol === "https:"
          ? url
          : url.replace("http://", "https://");

      return {
        isValid: true,
        normalizedUrl,
      };
    } catch (error) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Invalid URL format",
      };
    }
  }

  // If no protocol, assume HTTPS and validate
  const urlWithProtocol = `https://${url}`;

  try {
    const parsedUrl = new URL(urlWithProtocol);

    // Basic validation
    if (!parsedUrl.hostname) {
      return {
        isValid: false,
        normalizedUrl: "",
        error: "Invalid hostname",
      };
    }

    return {
      isValid: true,
      normalizedUrl: urlWithProtocol,
    };
  } catch (error) {
    return {
      isValid: false,
      normalizedUrl: "",
      error: "Invalid URL format",
    };
  }
}

/**
 * Gets a validated URL from environment variable
 * Throws an error if the URL is invalid
 */
export function getValidatedUrl(envVar: string): string {
  const validation = validateUrl(process.env[envVar]);

  if (!validation.isValid) {
    throw new Error(`Invalid ${envVar}: ${validation.error}`);
  }

  return validation.normalizedUrl;
}

/**
 * Gets a validated URL from environment variable with fallback
 * Returns null if the URL is invalid or not provided
 */
export function getValidatedUrlSafe(envVar: string): string | null {
  const validation = validateUrl(process.env[envVar]);

  if (!validation.isValid) {
    console.warn(`⚠️  Invalid ${envVar}: ${validation.error}`);
    return null;
  }

  return validation.normalizedUrl;
}
