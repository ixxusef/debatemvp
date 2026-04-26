type G = () => Promise<string | null>;
let getTokenImpl: G = async () => null;

export function setGetToken(fn: G) {
  getTokenImpl = fn;
}

export function getToken() {
  return getTokenImpl();
}
