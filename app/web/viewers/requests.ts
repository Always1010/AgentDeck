/** One current read per operation; superseded reads cannot publish a result. */
export class LatestRead {
  private controller?: AbortController;

  begin() {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    return { signal: controller.signal, current: () => this.controller === controller && !controller.signal.aborted };
  }

  cancel() {
    this.controller?.abort();
    this.controller = undefined;
  }
}
