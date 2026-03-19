/**
 * A general streaming JSON parser that can handle partial JSON data
 * by completing missing brackets, braces, and quotes.
 */

/**
 * Parses streaming JSON content that may be incomplete or malformed.
 * Attempts to complete partial JSON by matching brackets, braces, and quotes.
 *
 * @param jsonString - The potentially incomplete JSON string
 * @returns The parsed object if successful, undefined otherwise
 */
export function parseStreamingJson<T = any>(jsonString: string): T | undefined {
  const maxFixAttempts = 3;

  if (!jsonString?.trim()) {
    return undefined;
  }

  try {
    // First attempt: try to parse as-is
    try {
      const parsed = JSON.parse(jsonString.replace(/'/g, '"'));
      return parsed as T;
    } catch {
      // Continue to completion attempts
    }

    // Attempt to fix and parse the JSON
    for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
      try {
        const completed = completePartialJson(jsonString, attempt);
        const parsed = JSON.parse(completed);
        return parsed as T;
      } catch {
        // Try next attempt or fail
      }
    }

    return undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Completes partial JSON by adding missing closing characters
 *
 * @param jsonStr - The partial JSON string
 * @param strategy - Different completion strategies (1-3)
 * @returns Completed JSON string
 */
function completePartialJson(jsonStr: string, strategy: number = 1): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let i = 0;

  // Parse through the string to track open brackets/braces/quotes
  while (i < jsonStr.length) {
    const char = jsonStr[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      i++;
      continue;
    }

    if (inString) {
      if (char === '"') {
        inString = false;
        stack.pop();
      }
    } else {
      switch (char) {
        case '"':
          inString = true;
          stack.push('"');
          break;
        case "{":
          stack.push("}");
          break;
        case "[":
          stack.push("]");
          break;
        case "}":
        case "]":
          if (stack.length > 0 && stack[stack.length - 1] === char) {
            stack.pop();
          }
          break;
      }
    }
    i++;
  }

  // Complete the JSON by adding missing closing characters
  let completed = jsonStr.trim();

  // Strategy 1: Basic completion
  if (strategy === 1) {
    if (inString) {
      completed += '"';
    }

    // Add closing brackets/braces in reverse order
    while (stack.length > 0) {
      const closing = stack.pop();
      if (closing && closing !== '"') {
        completed += closing;
      }
    }
  }

  // Strategy 2: Try to close incomplete values and handle trailing commas
  else if (strategy === 2) {
    if (inString) {
      completed += '"';
    }

    // Handle trailing commas in arrays and objects
    completed = completed.replace(/,(\s*)([\]\}])/g, "$1$2");
    if (completed.endsWith(",")) {
      completed = completed.slice(0, -1);
    }

    while (stack.length > 0) {
      const closing = stack.pop();
      if (closing && closing !== '"') {
        completed += closing;
      }
    }
  }

  // Strategy 3: More aggressive completion with null values and incomplete keys
  else if (strategy === 3) {
    // Handle incomplete strings (including incomplete keys)
    if (inString) {
      completed += '"';

      // If this was an incomplete key, add colon and null value
      if (completed.match(/[{,]\s*"[^"]*"\s*$/)) {
        completed += ": null";
      }
    }
    // Handle incomplete values after colons
    else if (completed.match(/:\s*$/)) {
      completed += "null";
    }
    // Handle incomplete unquoted keys (though this is not standard JSON)
    else if (completed.match(/[{,]\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*$/)) {
      const match = completed.match(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*$/);
      if (match) {
        completed = completed.replace(
          match[0],
          `${match[1]}"${match[2]}": null`
        );
      }
    }
    // Clean up trailing commas
    else if (completed.endsWith(",")) {
      completed = completed.slice(0, -1);
    }

    // Close all open structures
    while (stack.length > 0) {
      const closing = stack.pop();
      if (closing && closing !== '"') {
        completed += closing;
      }
    }
  }

  return completed;
}
