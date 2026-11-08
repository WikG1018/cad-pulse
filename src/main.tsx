import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import Hud from "./screens/Hud";
import Dashboard from "./screens/Dashboard";
import "./styles/theme.css";

const label = getCurrentWebviewWindow().label;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{label === "dashboard" ? <Dashboard /> : <Hud />}</React.StrictMode>,
);
