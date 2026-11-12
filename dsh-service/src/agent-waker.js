export class AgentWaker {
  #running = false;
  #pending = false;
  #send;
  #sentCount = 0;

  constructor({ send }) {
    if (typeof send !== 'function') throw new TypeError('send must be a function');
    this.#send = send;
  }

  request() {
    if (this.#running) {
      this.#pending = true;
      return false;
    }

    this.#running = true;
    this.#sentCount += 1;
    Promise.resolve()
      .then(() => this.#send())
      .catch(() => {
        this.#running = false;
      });
    return true;
  }

  setRunning(running) {
    this.#running = Boolean(running);
    if (this.#running || !this.#pending) return;

    this.#pending = false;
    this.request();
  }

  snapshot() {
    return {
      running: this.#running,
      pending: this.#pending,
      sentCount: this.#sentCount,
    };
  }
}
