#include <Wire.h>               // MPU6050 使用 I2C，需要 Wire 库
#include <Adafruit_MPU6050.h>   // Adafruit MPU6050 库
#include <Adafruit_Sensor.h>    // Adafruit 传感器通用库
#include <Adafruit_NeoPixel.h>  // Adafruit NeoPixel 灯带库

// 添加WiFi和WebSocket相关库
#include <WiFi.h>               // ESP32 WiFi库
#include <AsyncTCP.h>           // 异步TCP库
#include <ESPAsyncWebServer.h>  // 异步Web服务器库
#include <ArduinoJson.h>        // JSON处理库
#include <ESPmDNS.h>            // mDNS库，用于本地域名

// ====== 引脚定义 ======
#define BUTTON_PIN 15  // 按钮引脚
#define MOTOR_PIN 33   // 马达引脚

#define LED_PIN 32     // LED 灯带数据引脚
#define NUMPIXELS 16   // LED 灯珠数量
#define TAIL_LENGTH 5  // LED 动画尾巴长度 (进度条长度)

// ====== 系统常量和计时器 ======
#define UART_BAUD 115200

const long statusInterval = 1000;  // 状态输出间隔 (ms)

unsigned long lastMpuTime = 0;     // 上次读取MPU数据的时间
unsigned long lastStatusTime = 0;  // 上次输出状态信息的时间

// ====== 按钮状态和消抖 ======
bool lastButtonState = HIGH;  // 假设按钮使用上拉电阻，按下为LOW
unsigned long lastDebounceTime = 0;
const long debounceDelay = 50;  // 消抖延迟 (ms)

// ====== 马达控制变量 ======
bool motorActive = false;             // 马达是否正在震动
int vibrationCount = 0;               // 震动次数计数
unsigned long lastVibrationTime = 0;  // 上次马达状态改变时间
const long vibrationDuration = 200;   // 每次震动 ON 持续时间 (ms)
const long vibrationInterval = 300;   // 每次震动 OFF 持续时间 (ms)
const int totalVibrationPulses = 3;   // 总共震动几次 (3次ON需要6个状态变化)

// ====== LED 控制变量和模式定义 ======
// 模式定义：
// 0: 关闭
// 1: 红色常亮
// 2: 蓝色常亮
// 3: 绿色常亮
// 4: 红色带尾巴转圈
// 5: 蓝色带尾巴转圈
int ledMode = 2;  // 初始默认模式为蓝色常亮

bool shouldAnimate = false;           // 是否应该执行动画更新
int currentLed = 0;                   // 当前动画的起始 LED 序号
unsigned long previousLedMillis = 0;  // 上次动画步进的时间
const long animationInterval = 80;    // 动画步进间隔 (ms)

// ====== WiFi和WebSocket配置 ======
const char *ssid = "Huawei Mate 50";      // WiFi名称
const char *password = "woshisjh";        // WiFi密码
const int webSocketPort = 81;             // WebSocket端口
const char *mdnsHostName = "crimescene";  // mDNS主机名

AsyncWebServer server(80);  // Web服务器实例，端口80
AsyncWebSocket ws("/ws");   // WebSocket实例，路径/ws

int connectedClients = 0;                         // 已连接客户端计数
bool automaticDataSending = false;                // 是否自动发送数据，默认关闭
unsigned long lastSensorDataTime = 0;             // 上次发送传感器数据的时间
const unsigned long SENSOR_DATA_INTERVAL = 1000;  // 传感器数据发送间隔(ms)

// ====== 硬件对象实例 ======
Adafruit_MPU6050 mpu;                                               // 创建MPU6050实例
Adafruit_NeoPixel strip(NUMPIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);  // 创建NeoPixel实例

// ====== 函数声明 ======
void connectToWiFi();
void setupAccessPoint();
void setupRoutes();
void initWebSocket();
void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len);
void handleWebSocketMessage(AsyncWebSocketClient *client, uint8_t *data, size_t len);
void sendMPUData(AsyncWebSocketClient *client);
void sendDeviceStatus(AsyncWebSocketClient *client);
void broadcastActionCompleted(int id);

// ====== 初始化函数 ======
void setup() {
  // 初始化串口通信
  Serial.begin(UART_BAUD);
  while (!Serial)
    ;  // 等待串口打开 (可选)
  Serial.println("系统初始化开始...");

  // 初始化按钮和马达引脚
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // 启用内部上拉
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);  // 确保马达初始关闭

  // 初始化MPU6050
  initMPU();

  // 初始化LED灯带
  strip.begin();
  strip.setBrightness(70);  // 设置亮度 (0-255)
  strip.clear();
  strip.show();

  // 设置初始 LED 模式 (默认红色常亮)
  setLedMode(ledMode);  // 初始 ledMode = 2

  // 初始化WiFi和WebSocket
  connectToWiFi();
  initWebSocket();
  setupRoutes();
  server.begin();
  Serial.println("网络服务已启动");

  Serial.println("系统初始化完成");
}

// ====== 各模块初始化细节 ======
void initMPU() {
  Serial.println("初始化MPU6050...");
  if (!mpu.begin()) {
    Serial.println("MPU6050初始化失败! 请检查接线.");
    return;  // 如果 MPU 不是必须的，返回并跳过 MPU 功能
  }

  // 设置 MPU 参数
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  Serial.println("MPU6050初始化完成");
}

// ====== 循环函数 ======
void loop() {
  unsigned long currentTime = millis();

  // ====== 各模块处理函数调用 ======

  // 处理按钮状态 (非阻塞)
  checkButton(currentTime);  // 传递当前时间用于消抖

  // 处理马达状态 (非阻塞)
  handleMotor(currentTime);  // 传递当前时间用于震动计时

  // 处理MPU数据（仅在串口监视）
  if (currentTime - lastMpuTime >= 100) {
    lastMpuTime = currentTime;
    handleMPU();
  }

  // 处理LED灯带动画或常亮 (非阻塞，转圈模式下内部有定时)
  handleLED(currentTime);  // 传递当前时间用于动画步进计时

  // 定期输出状态信息到串口（仅调试用）
  if (currentTime - lastStatusTime >= statusInterval) {
    lastStatusTime = currentTime;
    printStatus();
  }

  // 如果开启了自动数据发送模式
  if (automaticDataSending && connectedClients > 0 && 
      currentTime - lastSensorDataTime >= SENSOR_DATA_INTERVAL) {
    lastSensorDataTime = currentTime;
    broadcastMPUData();
  }

  // WiFi重连检查（每10秒）
  static unsigned long lastWifiCheck = 0;
  if (currentTime - lastWifiCheck >= 10000) {
    lastWifiCheck = currentTime;
    if (WiFi.status() != WL_CONNECTED && WiFi.getMode() == WIFI_STA) {
      Serial.println("WiFi断线，尝试重连...");
      WiFi.reconnect();
    }
  }
}

// ====== 各模块处理函数细节 ======

// 打印系统状态（仅串口输出）
void printStatus() {
  Serial.println("====系统状态====");
  Serial.print("当前LED模式: ");
  switch (ledMode) {
    case 0: Serial.println("0: 关闭"); break;
    case 1: Serial.println("1: 红色常亮"); break;
    case 2: Serial.println("2: 蓝色常亮"); break;
    case 3: Serial.println("3: 绿色常亮"); break;
    case 4: Serial.println("4: 红色带尾巴转圈"); break;
    case 5: Serial.println("5: 蓝色带尾巴转圈"); break;
    default: Serial.println("未知模式!");
  }
  Serial.print("马达状态: ");
  Serial.println(motorActive ? "震动中" : "静止");
  Serial.println("================");
}

// 处理MPU6050传感器数据（仅串口输出）
void handleMPU() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);  // 读取传感器数据

  // 输出MPU6050数据到串口
  Serial.print("MPU:|");
  Serial.print(a.acceleration.x, 2);
  Serial.print(",");
  Serial.print(a.acceleration.y, 2);
  Serial.print(",");
  Serial.print(a.acceleration.z, 2);
  Serial.print(",");
  Serial.print(g.gyro.x, 2);
  Serial.print(",");
  Serial.print(g.gyro.y, 2);
  Serial.print(",");
  Serial.print(g.gyro.z, 2);
  Serial.println("|");
}

// 检测按钮状态
void checkButton(unsigned long currentTime) {
  // 读取当前按钮状态
  int reading = digitalRead(BUTTON_PIN);

  // 如果状态变化，重置消抖计时器
  if (reading != lastButtonState) {
    lastDebounceTime = currentTime;
  }

  // 如果消抖时间已过且按钮当前是按下状态 (LOW)
  if ((currentTime - lastDebounceTime) > debounceDelay) {
    // 检测到按钮从 HIGH 变为 LOW (按下)
    if (reading == LOW && lastButtonState == HIGH) {
      Serial.println("BTN_PRESSED");
    }
  }

  // 保存按钮状态用于下次比较
  lastButtonState = reading;
}

// 启动马达震动
void startMotorVibration(unsigned long currentTime) {
  // 只有在当前马达未震动时才启动新的震动序列
  if (!motorActive) {
    motorActive = true;
    vibrationCount = 0;               // 重置计数
    lastVibrationTime = currentTime;  // 记录启动时间
    digitalWrite(MOTOR_PIN, HIGH);    // 打开马达
    Serial.println("MOTOR:ON");
    // 不自动发送WebSocket消息，只有在通过命令触发时才发送
  }
}

// 处理马达震动状态
void handleMotor(unsigned long currentTime) {
  if (motorActive) {
    unsigned long elapsedTime = currentTime - lastVibrationTime;

    // 马达震动逻辑：ON/OFF 交替，共 totalVibrationPulses 次 ON
    if (vibrationCount < totalVibrationPulses * 2) {
      if (vibrationCount % 2 == 0) {  // 当前是 ON 阶段
        if (elapsedTime >= vibrationDuration) {
          digitalWrite(MOTOR_PIN, LOW);  // 关闭马达
          Serial.println("MOTOR:OFF");
          lastVibrationTime = currentTime;
          vibrationCount++;  // 进入 OFF 阶段
        }
      } else {  // 当前是 OFF 阶段
        if (elapsedTime >= vibrationInterval) {
          digitalWrite(MOTOR_PIN, HIGH);  // 打开马达
          Serial.println("MOTOR:ON");
          lastVibrationTime = currentTime;
          vibrationCount++;  // 进入下一个 ON 阶段或结束
        }
      }
    } else {  // 完成所有震动脉冲
      digitalWrite(MOTOR_PIN, LOW);  // 确保马达最终关闭
      Serial.println("MOTOR:STOP");
      motorActive = false;  // 结束震动状态
      // 不自动发送WebSocket消息
    }
  }
}

// 设置 LED 模式
void setLedMode(int mode) {
  ledMode = mode;  // 更新模式
  Serial.print("LED_MODE:");
  Serial.println(ledMode);
  
  // 切换模式时，通常需要重置动画状态或者立即设置常亮颜色
  currentLed = 0;  // 重置动画起始位置

  switch (ledMode) {
    case 0:  // 关闭所有LED
      shouldAnimate = false;
      strip.clear();  // 清空像素
      strip.show();   // 显示清空状态
      break;
    case 1:  // 红色常亮
      shouldAnimate = false;
      constantColor(strip.Color(255, 0, 0));  // 设置常亮颜色并显示
      break;
    case 2:  // 蓝色常亮
      shouldAnimate = false;
      constantColor(strip.Color(0, 0, 255));  // 设置常亮颜色并显示
      break;
    case 3:  // 绿色常亮
      shouldAnimate = false;
      constantColor(strip.Color(0, 255, 0));  // 设置常亮颜色并显示
      break;
    case 4:  // 红色带尾巴转圈
      shouldAnimate = true;
      // 动画将在 handleLED 中根据定时器绘制和显示
      break;
    case 5:  // 蓝色带尾巴转圈
      shouldAnimate = true;
      // 动画将在 handleLED 中根据定时器绘制和显示
      break;
  }
  // 不自动发送WebSocket消息
}

// 处理LED动画
void handleLED(unsigned long currentTime) {
  // 只在需要动画时，且时间间隔到了才更新LED显示
  if (shouldAnimate) {
    if (currentTime - previousLedMillis >= animationInterval) {
      previousLedMillis = currentTime;  // 更新上次动画时间

      strip.clear();  // 清空上一帧

      // 根据当前模式确定颜色 (只处理转圈模式 4 和 5)
      uint32_t color;
      if (ledMode == 4) {
        color = strip.Color(255, 0, 0);  // 红色
      } else if (ledMode == 5) {
        color = strip.Color(0, 0, 255);  // 蓝色
      } else {
        // 如果 shouldAnimate 是 true 但 mode 不是 4 或 5，说明逻辑有问题
        shouldAnimate = false;  // 避免无限循环
        strip.clear();
        strip.show();  // 清屏
        return;
      }

      // 绘制带渐变尾巴的LED动画
      for (int i = 0; i < TAIL_LENGTH; i++) {
        // 计算像素位置，确保循环并在 currentLed 之后绘制尾巴 (逆时针方向转动)
        int pos = (currentLed - i + NUMPIXELS) % NUMPIXELS;

        // 计算亮度衰减：头部最亮，尾巴逐渐变暗
        int brightness = 255;
        // 避免除以零或 TAIL_LENGTH=0 导致问题
        if (TAIL_LENGTH > 0) {
          brightness = 255 * (TAIL_LENGTH - i) / TAIL_LENGTH;
        }

        // 从颜色中提取各个RGB分量
        uint8_t red = (uint8_t)(color >> 16);
        uint8_t green = (uint8_t)(color >> 8);
        uint8_t blue = (uint8_t)(color);

        // 计算衰减后的颜色
        uint32_t fadeColor = strip.Color(
          (red * brightness) / 255,
          (green * brightness) / 255,
          (blue * brightness) / 255);

        strip.setPixelColor(pos, fadeColor);
      }

      strip.show();  // 显示更新后的灯带状态

      // 移动动画的起始位置到下一个像素 (顺时针方向转动)
      currentLed = (currentLed + 1) % NUMPIXELS;
    }
  }
}

// 设置灯带为常亮颜色并显示
void constantColor(uint32_t c) {
  strip.fill(c, 0, NUMPIXELS);  // 填充所有像素
  strip.show();                 // 显示
}

// ====== WiFi连接函数 ======
void connectToWiFi() {
  Serial.printf("正在连接WiFi: %s ...\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  // 尝试连接WiFi，最多等待10秒
  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi已连接，IP地址: %s\n", WiFi.localIP().toString().c_str());

    // 设置mDNS服务，让设备可以通过crimescene.local访问
    if (MDNS.begin(mdnsHostName)) {
      MDNS.addService("http", "tcp", 80);
      MDNS.addService("ws", "tcp", webSocketPort);
      Serial.printf("mDNS已启动，设备可通过 http://%s.local 访问\n", mdnsHostName);
    }
  } else {
    Serial.println("\nWiFi连接失败，启动AP模式");
    setupAccessPoint();
  }
}

// 配置AP模式（当WiFi连接失败时使用）
void setupAccessPoint() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("CrimeScene-AP", "crimescene123");  // AP名称和密码
  Serial.printf("AP模式已启动，IP地址: %s\n", WiFi.softAPIP().toString().c_str());

  if (MDNS.begin(mdnsHostName)) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", webSocketPort);
  }
}

// 设置Web服务器路由
void setupRoutes() {
  // 主页路由
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/html",
                  "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>ESP32犯罪现场设备</title></head>"
                  "<body style='font-family:Arial,sans-serif;text-align:center;padding:20px;'>"
                  "<h1>ESP32犯罪现场互动设备</h1>"
                  "<p>状态: <span id='status'>等待连接...</span></p>"
                  "<p>WebSocket接口: <code>ws://" 
                  + WiFi.localIP().toString() + "/ws</code></p>"
                  "<script>const ws=new WebSocket('ws://'+location.hostname+'/ws');"
                  "ws.onopen=()=>document.getElementById('status').textContent='已连接';"
                  "ws.onclose=()=>document.getElementById('status').textContent='已断开';"
                  "</script></body></html>");
  });

  // 404页面
  server.onNotFound([](AsyncWebServerRequest *request) {
    request->send(404, "text/plain", "页面未找到");
  });
}

// 初始化WebSocket
void initWebSocket() {
  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  Serial.println("WebSocket服务器已初始化");
}

// WebSocket事件处理
void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      connectedClients++;
      Serial.printf("[WebSocket] 客户端 #%u 已连接\n", client->id());
      {
        DynamicJsonDocument doc(256);
        doc["type"] = "connection";
        doc["status"] = "connected";
        doc["message"] = "ESP32已连接";
        doc["deviceId"] = mdnsHostName;
        String response;
        serializeJson(doc, response);
        client->text(response);
      }
      break;

    case WS_EVT_DISCONNECT:
      connectedClients--;
      Serial.printf("[WebSocket] 客户端 #%u 已断开\n", client->id());
      break;

    case WS_EVT_DATA:
      handleWebSocketMessage(client, data, len);
      break;

    default:
      break;
  }
}

// 处理WebSocket消息 - 这是主要的命令处理中心
void handleWebSocketMessage(AsyncWebSocketClient *client, uint8_t *data, size_t len) {
  // 为消息创建一个结束符
  char *message = (char *)malloc(len + 1);
  memcpy(message, data, len);
  message[len] = '\0';

  // 解析JSON消息
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, message);
  free(message);

  if (error) {
    Serial.printf("[WebSocket] 解析JSON失败: %s\n", error.c_str());
    return;
  }

  // 检查消息中是否包含command字段
  if (!doc.containsKey("command")) return;

  String command = doc["command"];
  Serial.printf("[WebSocket] 收到命令: %s\n", command.c_str());

  // 处理不同的命令
  if (command == "getMPUData") {
    // 只有收到请求时才发送MPU数据
    sendMPUData(client);
  } 
  else if (command == "getStatus") {
    // 发送设备当前状态
    sendDeviceStatus(client);
  }
  else if (command == "ping") {
    // 回应ping请求
    DynamicJsonDocument response(128);
    response["command"] = "pong";
    response["timestamp"] = millis();
    String responseStr;
    serializeJson(response, responseStr);
    client->text(responseStr);
  }
  else if (command == "setLedMode" && doc.containsKey("mode")) {
    // 设置LED模式
    int mode = doc["mode"];
    if (mode >= 0 && mode <= 5) {
      // 无论当前模式是什么，都强制更新显示
      setLedMode(mode);
      
      // 使用yield()给系统一点时间处理
      yield();

      // 仅在收到命令时发送响应
      DynamicJsonDocument response(128);
      response["type"] = "ledMode";
      response["status"] = "success";
      response["mode"] = mode;
      response["animate"] = (mode == 4 || mode == 5);
      String responseStr;
      serializeJson(response, responseStr);
      client->text(responseStr);
    }
  }
  else if (command == "vibrate") {
    // 触发马达震动
    startMotorVibration(millis());

    // 仅在收到命令时发送响应
    DynamicJsonDocument response(128);
    response["type"] = "vibration";
    response["status"] = "started";
    response["pulses"] = totalVibrationPulses;
    String responseStr;
    serializeJson(response, responseStr);
    client->text(responseStr);
  }
  else if (command == "getButtonState") {
    // 获取按钮当前状态
    sendButtonState(client);
  }
  else if (command == "setAutomaticDataSending") {
    // 开启或关闭自动数据发送
    if (doc.containsKey("enabled")) {
      automaticDataSending = doc["enabled"];
      
      DynamicJsonDocument response(128);
      response["type"] = "automaticDataSending";
      response["status"] = automaticDataSending ? "enabled" : "disabled";
      String responseStr;
      serializeJson(response, responseStr);
      client->text(responseStr);
    }
  }
}

// 发送按钮状态
void sendButtonState(AsyncWebSocketClient *client) {
  DynamicJsonDocument doc(128);
  doc["type"] = "buttonState";
  doc["state"] = digitalRead(BUTTON_PIN) == LOW ? "pressed" : "released";
  doc["timestamp"] = millis();
  
  String response;
  serializeJson(doc, response);
  client->text(response);
}

// 发送MPU6050数据
void sendMPUData(AsyncWebSocketClient *client) {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);  // 读取传感器数据

  // 创建JSON文档
  DynamicJsonDocument doc(256);
  doc["type"] = "mpuData";
  doc["timestamp"] = millis();
  
  // 加速度数据
  JsonObject accel = doc.createNestedObject("acceleration");
  accel["x"] = a.acceleration.x;
  accel["y"] = a.acceleration.y;
  accel["z"] = a.acceleration.z;
  
  // 陀螺仪数据
  JsonObject gyro = doc.createNestedObject("gyro");
  gyro["x"] = g.gyro.x;
  gyro["y"] = g.gyro.y;
  gyro["z"] = g.gyro.z;

  // 序列化并发送
  String response;
  serializeJson(doc, response);
  client->text(response);
}

// 广播MPU6050数据（仅当开启自动发送时使用）
void broadcastMPUData() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // 创建JSON文档
  DynamicJsonDocument doc(256);
  doc["type"] = "mpuData";
  doc["timestamp"] = millis();
  
  // 加速度数据
  JsonObject accel = doc.createNestedObject("acceleration");
  accel["x"] = a.acceleration.x;
  accel["y"] = a.acceleration.y;
  accel["z"] = a.acceleration.z;
  
  // 陀螺仪数据
  JsonObject gyro = doc.createNestedObject("gyro");
  gyro["x"] = g.gyro.x;
  gyro["y"] = g.gyro.y;
  gyro["z"] = g.gyro.z;

  // 序列化并广播
  String message;
  serializeJson(doc, message);
  ws.textAll(message);
}

// 发送设备当前状态
void sendDeviceStatus(AsyncWebSocketClient *client) {
  DynamicJsonDocument doc(256);
  doc["type"] = "deviceStatus";
  doc["timestamp"] = millis();
  doc["ledMode"] = ledMode;
  doc["motorActive"] = motorActive;
  doc["buttonState"] = digitalRead(BUTTON_PIN) == LOW ? "pressed" : "released";
  doc["automaticDataSending"] = automaticDataSending;
  
  String response;
  serializeJson(doc, response);
  client->text(response);
}

// 广播动作完成事件（预留函数，当前不使用）
void broadcastActionCompleted(int actionId) {
  DynamicJsonDocument doc(256);
  doc["type"] = "actionCompleted";
  doc["actionId"] = actionId;
  doc["timestamp"] = millis();

  String message;
  serializeJson(doc, message);
  ws.textAll(message);
}