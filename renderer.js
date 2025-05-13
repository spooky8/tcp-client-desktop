const net = require("net")
const { v4: uuidv4 } = require("uuid")
const { ipcRenderer } = require("electron")
const Store = require("electron-store")
const os = require("os")

// Инициализация локального хранилища
const store = new Store()

class TCPClient {
  constructor() {
    // Значения по умолчанию, которые будут переопределены настройками
    this.serverHost = "127.0.0.1"
    this.serverPort = 8000
    this.clientId = uuidv4()
    this.listenHost = store.get("listenHost") || this.getDefaultNetworkInterface()
    this.roomAddr = null
    this.listenerPort = null
    this.listenerServer = null
    this.connected = false

    console.log("Клиент инициализирован с ID:", this.clientId)
    console.log("Используется сетевой интерфейс:", this.listenHost)

    // Инициализация элементов UI
    this.initUIElements()
    this.setupEventListeners()
    this.loadSettings().then(() => {
      this.updateUI()
      this.setupMessageListener()

      // Показываем приветственное сообщение
      this.appendMessage(
        "Добро пожаловать в TCP Чат! Создайте комнату или подключитесь к существующей, чтобы начать общение.",
        "system",
      )
    })
  }

  // Получение IP-адреса основного сетевого интерфейса
  getDefaultNetworkInterface() {
    const interfaces = os.networkInterfaces()
    let defaultIP = "127.0.0.1" // По умолчанию localhost

    // Перебираем все сетевые интерфейсы
    for (const name in interfaces) {
      const iface = interfaces[name]
      // Ищем IPv4 адрес, который не является внутренним и не loopback
      for (const entry of iface) {
        if (entry.family === "IPv4" && !entry.internal) {
          defaultIP = entry.address
          console.log(`Найден сетевой интерфейс: ${name} с IP: ${defaultIP}`)
          return defaultIP
        }
      }
    }

    console.log(`Не найдено внешних сетевых интерфейсов, используется: ${defaultIP}`)
    return defaultIP
  }

  async loadSettings() {
    try {
      // Загружаем настройки из основного процесса
      const settings = await ipcRenderer.invoke("get-settings")
      this.serverHost = settings.serverHost
      this.serverPort = settings.serverPort
      this.listenHost = settings.listenHost || this.listenHost

      // Обновляем UI настроек
      this.serverHostInput.value = this.serverHost
      this.serverPortInput.value = this.serverPort
      this.listenHostInput.value = this.listenHost

      console.log("Настройки загружены:", settings)
    } catch (error) {
      console.error("Ошибка загрузки настроек:", error)
    }
  }

  async saveSettings() {
    try {
      const settings = {
        serverHost: this.serverHostInput.value,
        serverPort: Number.parseInt(this.serverPortInput.value, 10),
        listenHost: this.listenHostInput.value,
      }

      // Сохраняем в основной процесс
      await ipcRenderer.invoke("save-settings", settings)

      // Обновляем локальные значения
      this.serverHost = settings.serverHost
      this.serverPort = settings.serverPort
      this.listenHost = settings.listenHost

      this.updateStatus("Настройки успешно сохранены", "success")
      console.log("Настройки сохранены:", settings)

      // Перезапускаем слушатель с новыми настройками
      this.setupMessageListener()

      return true
    } catch (error) {
      console.error("Ошибка сохранения настроек:", error)
      this.updateStatus(`Ошибка сохранения настроек: ${error.message}`, "error")
      return false
    }
  }

  initUIElements() {
    // Навигация
    this.navLinks = document.querySelectorAll(".nav-link")
    this.pages = document.querySelectorAll(".page")

    // Элементы чата
    this.createRoomBtn = document.getElementById("createRoomBtn")
    this.connectRoomBtn = document.getElementById("connectRoomBtn")
    this.disconnectBtn = document.getElementById("disconnectBtn")
    this.sendMessageBtn = document.getElementById("sendMessageBtn")
    this.roomAddrInput = document.getElementById("roomAddrInput")
    this.messageInput = document.getElementById("messageInput")
    this.messageLog = document.getElementById("messageLog")
    this.status = document.getElementById("status")
    this.connectionStatus = document.getElementById("connectionStatus")
    this.statusText = document.getElementById("statusText")
    this.roomInfo = document.getElementById("roomInfo")
    this.clearHistoryBtn = document.getElementById("clearHistoryBtn")

    // Элементы настроек
    this.serverHostInput = document.getElementById("serverHostInput")
    this.serverPortInput = document.getElementById("serverPortInput")
    this.listenHostInput = document.getElementById("listenHostInput")
    this.saveSettingsBtn = document.getElementById("saveSettingsBtn")
    this.detectNetworkBtn = document.getElementById("detectNetworkBtn")
  }

  setupEventListeners() {
    // Навигация
    this.navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        const targetPage = link.getAttribute("data-page")
        this.navigateTo(targetPage)
      })
    })

    // Действия чата
    this.createRoomBtn.addEventListener("click", () => this.createRoom())
    this.connectRoomBtn.addEventListener("click", () => this.connectToRoom(this.roomAddrInput.value))
    this.disconnectBtn.addEventListener("click", () => this.disconnectFromRoom())
    this.sendMessageBtn.addEventListener("click", () => this.sendMessage(this.messageInput.value))
    this.messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && this.messageInput.value) {
        this.sendMessage(this.messageInput.value)
      }
    })

    // Добавляем обработчик для кнопки очистки истории, если она существует
    if (this.clearHistoryBtn) {
      this.clearHistoryBtn.addEventListener("click", () => this.clearMessageHistory())
    }

    // Действия настроек
    this.saveSettingsBtn.addEventListener("click", () => this.saveSettings())
    this.detectNetworkBtn.addEventListener("click", () => {
      const detectedIP = this.getDefaultNetworkInterface()
      this.listenHostInput.value = detectedIP
      this.updateStatus(`Обнаружен IP-адрес: ${detectedIP}`, "success")
    })
  }

  navigateTo(pageId) {
    // Обновляем активную ссылку навигации
    this.navLinks.forEach((link) => {
      if (link.getAttribute("data-page") === pageId) {
        link.classList.add("active")
      } else {
        link.classList.remove("active")
      }
    })

    // Показываем активную страницу
    this.pages.forEach((page) => {
      if (page.id === `${pageId}Page`) {
        page.classList.add("active")
      } else {
        page.classList.remove("active")
      }
    })
  }

  updateUI() {
    const isConnected = this.connected
    this.disconnectBtn.disabled = !isConnected
    this.sendMessageBtn.disabled = !isConnected
    this.messageInput.disabled = !isConnected
    this.createRoomBtn.disabled = isConnected
    this.connectRoomBtn.disabled = isConnected
    this.roomAddrInput.disabled = isConnected

    if (isConnected) {
      this.connectionStatus.className = "status-indicator online"
      this.statusText.textContent = "Подключен"
      this.roomInfo.textContent = `Комната: ${this.roomAddr}`
    } else {
      this.connectionStatus.className = "status-indicator offline"
      this.statusText.textContent = "Не подключен"
      this.roomInfo.textContent = ""
    }
  }

  updateStatus(message, type = "") {
    this.status.textContent = message
    this.status.className = type ? `status-message ${type}` : "status-message"

    // Очищаем статус через 5 секунд
    setTimeout(() => {
      this.status.textContent = ""
      this.status.className = "status-message"
    }, 5000)
  }

  // Изменение метода appendMessage для поддержки своих сообщений
  appendMessage(message, type = "system", sender = "", time = "", isSelf = false) {
    const div = document.createElement("div")
    div.className = `message ${type}${isSelf ? " self" : ""}`

    if (type !== "system") {
      const senderDiv = document.createElement("div")
      senderDiv.className = "sender"
      senderDiv.textContent = sender
      div.appendChild(senderDiv)
    }

    const messageContent = document.createElement("div")
    messageContent.textContent = message
    div.appendChild(messageContent)

    if (time) {
      const timeDiv = document.createElement("div")
      timeDiv.className = "time"
      timeDiv.textContent = time
      div.appendChild(timeDiv)
    }

    this.messageLog.appendChild(div)
    this.messageLog.scrollTop = this.messageLog.scrollHeight
  }

  // Отправка запроса на сервер (для создания комнаты)
  async sendRequestToServer(request) {
    console.log("Отправка запроса на сервер:", request)

    return new Promise((resolve, reject) => {
      const client = new net.Socket()
      client.setTimeout(5000)

      client.connect(
        {
          host: this.serverHost,
          port: this.serverPort,
        },
        () => {
          client.write(JSON.stringify(request) + "\n")
        },
      )

      let responseData = ""
      client.on("data", (data) => {
        responseData += data.toString()
        console.log("Сырой ответ сервера:", data.toString())

        try {
          const response = JSON.parse(responseData.trim())
          console.log("Разобранный ответ сервера:", response)
          resolve(response)
        } catch (error) {
          // Если данные неполные, продолжаем получать
          console.log("Неполный ответ сервера, ожидание продолжения...")
        }
      })

      client.on("error", (error) => {
        console.error("Ошибка запроса к серверу:", error)
        client.destroy()
        reject(error)
      })

      client.on("timeout", () => {
        console.error("Таймаут запроса к серверу")
        client.destroy()
        reject(new Error("Превышено время ожидания соединения"))
      })

      client.on("end", () => {
        try {
          if (responseData) {
            const response = JSON.parse(responseData.trim())
            resolve(response)
          } else {
            reject(new Error("Не получен ответ"))
          }
        } catch (error) {
          reject(new Error("Не удалось разобрать ответ"))
        }
      })
    })
  }

  // Отправка запроса в комнату
  async sendRequestToRoom(request, roomAddress) {
    // Используем переданный адрес комнаты или сохраненный адрес
    const addr = roomAddress || this.roomAddr

    if (!addr) {
      throw new Error("Адрес комнаты не задан")
    }

    console.log(`Отправка запроса в комнату по адресу ${addr}:`, request)

    return new Promise((resolve, reject) => {
      const [host, portStr] = addr.split(":")
      const port = Number.parseInt(portStr, 10)

      const client = new net.Socket()
      client.setTimeout(5000)

      client.connect(
        {
          host,
          port,
        },
        () => {
          client.write(JSON.stringify(request) + "\n")
        },
      )

      let responseData = ""
      client.on("data", (data) => {
        responseData += data.toString()
        console.log("Сырой ответ комнаты:", data.toString())

        try {
          const response = JSON.parse(responseData.trim())
          console.log("Разобранный ответ комнаты:", response)
          resolve(response)
        } catch (error) {
          // Если данные неполные, продолжаем получать
          console.log("Неполный ответ комнаты, ожидание продолжения...")
        }
      })

      client.on("error", (error) => {
        console.error("Ошибка запроса к комнате:", error)
        client.destroy()
        reject(error)
      })

      client.on("timeout", () => {
        console.error("Таймаут запроса к комнате")
        client.destroy()
        reject(new Error("Превышено время ожидания соединения"))
      })

      client.on("end", () => {
        try {
          if (responseData) {
            const response = JSON.parse(responseData.trim())
            resolve(response)
          } else {
            reject(new Error("Не получен ответ"))
          }
        } catch (error) {
          reject(new Error("Не удалось разобрать ответ"))
        }
      })
    })
  }

  // Убедимся, что слушатель всегда использует случайный порт
  setupMessageListener() {
    // Закрываем существующий слушатель, если он есть
    if (this.listenerServer) {
      try {
        this.listenerServer.close()
      } catch (error) {
        console.error("Ошибка закрытия существующего слушателя:", error)
      }
    }

    this.listenerServer = net.createServer((socket) => {
      console.log("Новый клиент подключился к слушателю")
      let messageData = ""

      socket.on("data", (data) => {
        console.log("Слушатель получил данные:", data.toString())
        messageData += data.toString()

        try {
          const message = JSON.parse(messageData.trim())
          console.log("Слушатель разобрал сообщение:", message)
          messageData = ""

          if (message.type === "send") {
            const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            const senderName = `User@${message.addr}`
            this.appendMessage(message.message, "user", senderName, time, false) // Добавлен параметр isSelf = false

            // Отправляем подтверждение получения
            const response = { type: "ok" }
            socket.write(JSON.stringify(response) + "\n")

            // Добавляем звуковое уведомление о новом сообщении
            this.playNotificationSound()
          }
        } catch (error) {
          console.log("Неполные данные сообщения, ожидание продолжения...")
        }
      })

      socket.on("error", (error) => {
        console.error("Ошибка сокета слушателя:", error)
      })

      socket.on("end", () => {
        console.log("Клиент слушателя отключился")
      })
    })

    // Слушаем на указанном IP-адресе и используем порт 0 для выбора случайного порта
    this.listenerServer.listen(0, this.listenHost, () => {
      this.listenerPort = this.listenerServer.address().port
      console.log(`Слушатель сообщений запущен на ${this.listenHost}:${this.listenerPort}`)
    })

    this.listenerServer.on("error", (error) => {
      console.error("Ошибка сервера слушателя:", error)
      this.updateStatus(`Ошибка слушателя: ${error.message}`, "error")
    })
  }

  // Получение локального IP-адреса для соединений
  getLocalAddress() {
    // Используем настроенный IP-адрес для прослушивания
    return this.listenHost
  }

  async createRoom() {
    this.connectionStatus.className = "status-indicator connecting"
    this.statusText.textContent = "Создание комнаты..."

    try {
      // По документации, для создания комнаты нужен только тип запроса
      // Но судя по логам, сервер ожидает ID
      const request = {
        type: "create",
        id: this.clientId,
      }

      const response = await this.sendRequestToServer(request)

      if (response.status === "ok") {
        this.roomAddr = response.addr
        this.updateStatus(`Комната создана: ${this.roomAddr}`, "success")
        this.appendMessage(`Комната создана по адресу ${this.roomAddr}`)

        // Обновляем поле ввода адреса комнаты
        this.roomAddrInput.value = this.roomAddr

        // Подключаемся к созданной комнате
        await this.connectToRoom(this.roomAddr)
      } else {
        throw new Error(response.status || "Неизвестная ошибка")
      }
    } catch (error) {
      this.connectionStatus.className = "status-indicator offline"
      this.statusText.textContent = "Не подключен"
      this.updateStatus(`Ошибка создания комнаты: ${error.message}`, "error")
    }
  }

  async connectToRoom(addr) {
    if (!addr.includes(":")) {
      this.updateStatus("Неверный формат адреса. Используйте хост:порт", "error")
      return
    }

    this.connectionStatus.className = "status-indicator connecting"
    this.statusText.textContent = "Подключение..."

    console.log(`Попытка подключения к комнате по адресу ${addr}`)

    try {
      // По документации и логам, для подключения к комнате нужно отправить ID и адрес для прослушивания
      const connectRequest = {
        type: "connect",
        id: this.clientId,
        addr: `${this.getLocalAddress()}:${this.listenerPort}`,
      }

      console.log(`Отправляем адрес для прослушивания: ${connectRequest.addr}`)

      // Передаем адрес комнаты в метод sendRequestToRoom
      const response = await this.sendRequestToRoom(connectRequest, addr)

      // Проверяем оба возможных формата ответа
      if (response.status === "ok" || response.type === "ok") {
        // Устанавливаем адрес комнаты только после успешного подключения
        this.roomAddr = addr
        this.connected = true
        this.updateStatus(`Подключено к комнате: ${addr}`, "success")
        this.appendMessage(`Подключено к комнате: ${addr}`)
        this.updateUI()
      } else {
        throw new Error(response.status || response.type || "Подключение отклонено")
      }
    } catch (error) {
      this.connected = false
      this.connectionStatus.className = "status-indicator offline"
      this.statusText.textContent = "Не подключен"
      this.updateStatus(`Ошибка подключения к комнате: ${error.message}`, "error")
      this.updateUI()
    }
  }

  // Изменение метода sendMessage для отображения своих сообщений справа и другого цвета
  async sendMessage(message) {
    if (!this.connected) {
      this.updateStatus("Не подключено ни к одной комнате", "error")
      return
    }

    if (!message.trim()) return

    try {
      // По документации, для отправки сообщения нужны поля type, msg и date
      // Добавляем ID, так как сервер, похоже, его ожидает
      const request = {
        type: "send",
        id: this.clientId,
        message: message.trim(),
        date: new Date().toISOString(),
      }

      const response = await this.sendRequestToRoom(request)

      // Проверяем оба возможных формата ответа
      if (response.status === "ok" || response.type === "ok") {
        // Отображаем сообщение после успешной отправки
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        const myAddr = `${this.getLocalAddress()}:${this.listenerPort}`
        this.appendMessage(message.trim(), "user", `User@${myAddr}`, time, true) // Добавлен параметр isSelf = true
        this.messageInput.value = ""
      } else {
        throw new Error(response.status || response.type || "Сообщение не доставлено")
      }
    } catch (error) {
      this.updateStatus(`Ошибка отправки сообщения: ${error.message}`, "error")
    }
  }

  async disconnectFromRoom() {
    if (!this.connected) {
      this.updateStatus("Не подключено ни к одной комнате", "error")
      return
    }

    try {
      // По документации, для отключения от комнаты нужен только тип запроса
      // Добавляем ID, так как сервер, похоже, его ожидает
      const request = {
        type: "disconnect",
        id: this.clientId,
      }

      const response = await this.sendRequestToRoom(request)

      // Проверяем оба возможных формата ответа
      if (response.status === "ok" || response.type === "ok") {
        this.roomAddr = null
        this.connected = false
        this.updateStatus("Отключено от комнаты", "success")
        this.appendMessage("Отключено от комнаты")
        this.updateUI()
      } else {
        throw new Error(response.status || response.type || "Ошибка отключения")
      }
    } catch (error) {
      // Даже если произошла ошибка, считаем что отключились
      this.roomAddr = null
      this.connected = false
      this.updateStatus(`Отключено с ошибкой: ${error.message}`, "error")
      this.appendMessage("Отключено от комнаты")
      this.updateUI()
    }
  }

  // Добавление звукового уведомления о новом сообщении
  playNotificationSound() {
    try {
      // Создаем аудио элемент и воспроизводим звук уведомления
      const audio = new Audio()
      audio.src = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU..." // Здесь будет base64 звука
      audio.volume = 0.5
      audio.play().catch((err) => console.log("Не удалось воспроизвести звук уведомления:", err))
    } catch (error) {
      console.error("Ошибка воспроизведения звука:", error)
    }
  }

  // Добавление метода для очистки истории сообщений
  clearMessageHistory() {
    this.messageLog.innerHTML = ""
    this.appendMessage("История сообщений очищена", "system")
  }
}

// Инициализация приложения
document.addEventListener("DOMContentLoaded", () => {
  new TCPClient()
})
