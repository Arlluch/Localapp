// main.js (Updated with .env integration and secure API handling)
require("dotenv").config();
const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const AWS = require("aws-sdk");
const axios = require("axios");

const REGION = process.env.AWS_REGION;
const CLIENT_ID = process.env.AWS_CLIENT_ID;
const API_KEY = process.env.API_KEY;
const API_BASE_URL = process.env.API_BASE_URL;
const GENERATE_API_URL = process.env.GENERATE_API_URL;

AWS.config.update({ region: REGION });
const cognito = new AWS.CognitoIdentityServiceProvider();
Menu.setApplicationMenu(null);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  },
});

let mainWindow;
let lastUserAttributes = null;

function createLoginWindow() {
  if (mainWindow) {
    mainWindow.loadFile("login.html");
  } else {
    mainWindow = new BrowserWindow({
      width: 480,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      icon: path.join(__dirname, "icon.ico"),
    });
    mainWindow.loadFile("login.html");
  }
}

function createDashboardWindow(attributes) {
  mainWindow.loadFile("dashboard.html");
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.send("user-info", attributes);
  });
}

ipcMain.handle("login", async (event, { email, password }) => {
  try {
    const authResponse = await cognito
      .initiateAuth({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
      .promise();

    const token = authResponse.AuthenticationResult.AccessToken;
    const userData = await cognito.getUser({ AccessToken: token }).promise();

    const attributes = {};
    userData.UserAttributes.forEach((attr) => {
      attributes[attr.Name] = attr.Value;
    });
    lastUserAttributes = attributes;

    const sub = attributes["sub"];
    const generateApiUrl = `${GENERATE_API_URL}?sub=${encodeURIComponent(
      sub
    )}&condition=testing`;

    try {
      const response = await fetch(generateApiUrl);
      const result = await response.json();
      console.log("API Key Response:", result);
    } catch (apiErr) {
      console.error("Failed to generate API keys:", apiErr);
    }

    const updatedUserData = await cognito
      .getUser({ AccessToken: token })
      .promise();
    const updatedAttributes = {};
    updatedUserData.UserAttributes.forEach((attr) => {
      updatedAttributes[attr.Name] = attr.Value;
    });
    lastUserAttributes = updatedAttributes;
    console.log("Updated Cognito attributes:", updatedAttributes);

    const apiKey = updatedAttributes["custom:APIKeys"];
    const apiId = updatedAttributes["custom:API_ID"];

    if (apiKey && apiId) {
      try {
        const save = await apiClient.post("/api/save-key", { apiKey, apiId });
        if (save.data?.success) {
          const verify = await apiClient.post("/api/verify-key", {
            apiKey,
            apiId,
          });
          if (verify.data?.success) {
            console.log("API key successfully saved to DigitalOcean.");
          } else {
            console.warn("Failed to save API key:", save.data?.message);
          }
        } else {
          console.log("API key already synced.");
        }
      } catch (err) {
        console.error("Error syncing API key:", err);
      }
    } else {
      console.warn("Missing API_ID or API key in attributes.");
    }

    createDashboardWindow(updatedAttributes);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle("get-user-attributes", () => lastUserAttributes);
ipcMain.on("logout", () => {
  lastUserAttributes = null;
  createLoginWindow();
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("save-file-dialog", async (event, options) => {
  const result = await dialog.showSaveDialog(options);
  return result;
});

ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"] });
  return result;
});

app.whenReady().then(createLoginWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
