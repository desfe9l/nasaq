/** A late response must not publish into a changed brief or unmounted owner. */
export function createGenerationRequestGuard() {
  let revision = 0;
  let key = "";
  return {
    update(next: string) {
      if (next !== key) {
        key = next;
        revision += 1;
      }
    },
    begin() {
      revision += 1;
      return revision;
    },
    current(ticket: number) {
      return ticket === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}
