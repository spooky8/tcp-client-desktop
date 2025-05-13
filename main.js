const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const Store = require("electron-store")

// Инициализация хранилища конфигурации
const store = new Store()

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "TCP Чат",
    backgroundColor: "#f9fafb",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    minWidth: 800,
    minHeight: 600,
  })

  win.loadFile("index.html")

  // Раскомментируйте, чтобы автоматически открывать DevTools
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

// Обработчики IPC для настроек
ipcMain.handle("get-settings", async () => {
  return {
    serverHost: store.get("serverHost", "127.0.0.1"),
    serverPort: store.get("serverPort", 8000),
    listenHost: store.get("listenHost", "127.0.0.1"),
  }
})

ipcMain.handle("save-settings", async (event, settings) => {
  store.set("serverHost", settings.serverHost)
  store.set("serverPort", settings.serverPort)
  store.set("listenHost", settings.listenHost)
  return { success: true }
})
