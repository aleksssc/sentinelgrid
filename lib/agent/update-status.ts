export function isExpectedUpdateResult(errorCode: string | null | undefined): boolean {
  return errorCode === "NO_NEWER_AGENT_VERSION" || errorCode === "NO_ELIGIBLE_AGENT_RELEASE";
}
