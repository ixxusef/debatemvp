import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";
import { setGetToken } from "../authGetToken";

export function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    if (!getToken) {
      setGetToken(async () => null);
      return;
    }
    setGetToken(() => getToken());
  }, [getToken]);
  return null;
}
