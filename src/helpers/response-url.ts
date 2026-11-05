/**
 * Set `url` and `redirected` on a `Response`, which the constructor cannot
 * do, so the result reads like one `fetch` returned.
 *
 * @param response - the response to annotate.
 * @param url - the URL of the final hop.
 * @param redirected - whether at least one redirect was followed.
 * @returns the same response object.
 * @internal
 */
export function withResponseUrl(
  response: Response,
  url: URL,
  redirected: boolean,
): Response {
  Object.defineProperty(response, "url", { value: url.href })
  Object.defineProperty(response, "redirected", { value: redirected })

  return response
}
