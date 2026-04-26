import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!key) {
  console.warn("VITE_CLERK_PUBLISHABLE_KEY is not set. Auth will not work until you add it in client/.env");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {key ? (
      <ClerkProvider publishableKey={key} afterSignOutUrl="/">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ClerkProvider>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>
);
