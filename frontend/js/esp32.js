/**
 * ESP32通信模块 - 用于与ESP32建立WebSocket连接并交换数据
 */

class ESP32Connection {
    constructor(serverIP, port = 81) {
      this.serverIP = serverIP;
      this.port = port;
      this.socket = null;
      this.isConnected = false;
      this.onDataCallbacks = [];
      this.onConnectCallbacks = [];
      this.onDisconnectCallbacks = [];
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.connectionTimeout = null;
      this.heartbeatTimeout = null;
      this.isManualDisconnect = false;
    }
  
    // 连接到ESP32 WebSocket服务器
    connect() {
      // 尝试多种URL格式
      let wsUrl;
      if (this.connectAttempt === undefined || this.connectAttempt >= 3) {
        this.connectAttempt = 0;
      }
      
      // 轮流尝试不同的URL格式
      switch(this.connectAttempt) {
        case 0:
          wsUrl = `ws://${this.serverIP}:${this.port}/ws`;
          break;
        case 1:
          wsUrl = `ws://${this.serverIP}:${this.port}`;
          break;
        case 2:
          wsUrl = `ws://${this.serverIP}/ws`;
          break;
      }
      
      this.connectAttempt++;
      console.log(`正在连接到ESP32 (尝试 ${this.connectAttempt}/3): ${wsUrl}`);
      
      // 如果已经有连接，先关闭
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          console.log('关闭现有连接时出错:', e);
        }
      }
      
      try {
        this.socket = new WebSocket(wsUrl);
        
        // 设置连接超时
        this.connectionTimeout = setTimeout(() => {
          if (!this.isConnected && this.socket) {
            console.log('连接超时');
            this.socket.close();
          }
        }, 10000); // 10秒连接超时
        
        this.socket.onopen = () => {
          console.log('已连接到ESP32');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // 清除连接超时定时器
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          
          // 设置心跳检测
          this.setupHeartbeat();
          
          // 触发回调
          this.onConnectCallbacks.forEach(callback => callback());
        };
        
        this.socket.onmessage = (event) => {
          // 收到消息意味着连接活跃，重置心跳计时器
          if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.setupHeartbeat();
          }
          
          console.log('收到原始WebSocket消息:', event.data);
          
          try {
            const data = JSON.parse(event.data);
            console.log('解析后的JSON数据:', data);
            console.log('消息类型:', data.type);
            if (data.type === 'stage_transition') {
              console.log('检测到Stage切换消息，stage值:', data.stage);
            }
            this.onDataCallbacks.forEach(callback => callback(data));
          } catch (e) {
            console.error('JSON解析错误:', e);
            console.log('收到非JSON数据:', event.data);
            // 如果不是JSON格式，直接传递原始数据
            this.onDataCallbacks.forEach(callback => callback(event.data));
          }
        };
        
        this.socket.onclose = (event) => {
          console.log(`与ESP32的连接已关闭 (代码: ${event.code})`);
          
          // 清除定时器
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          
          if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
          }
          
          // 只有当前是连接状态时才触发断开回调
          if (this.isConnected) {
            this.isConnected = false;
            this.onDisconnectCallbacks.forEach(callback => callback());
          }
          
          // 如果不是主动关闭，尝试重连
          const normalClosure = event.code === 1000 || event.code === 1001;
          if (!normalClosure && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
            console.log(`尝试重新连接 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，等待 ${delay}ms...`);
            
            setTimeout(() => {
              if (!this.isConnected) {
                this.connect();
              }
            }, delay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('达到最大重连次数，停止重连');
          }
        };
        
        this.socket.onerror = (error) => {
          console.log('WebSocket错误 - 这通常不会导致连接断开');
          // 错误事件之后通常会触发close事件，所以这里不做额外处理
        };
      } catch (error) {
        console.error('创建WebSocket连接时出错:', error);
        // 尝试重连
        setTimeout(() => {
          if (!this.isConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.connect();
          }
        }, 2000);
      }
    }
    
    // 设置心跳检测
    setupHeartbeat() {
      // 清除现有定时器
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
      }
      
      // 设置新的心跳超时
      this.heartbeatTimeout = setTimeout(() => {
        console.log('心跳超时，检查连接');
        
        // 发送ping消息检查连接
        if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
          try {
            this.sendCommand('ping');
            
            // 设置响应超时
            this.heartbeatTimeout = setTimeout(() => {
              console.log('心跳无响应，重新连接');
              this.resetAndReconnect();
            }, 5000);
          } catch (e) {
            console.error('发送心跳失败:', e);
            this.resetAndReconnect();
          }
        }
      }, 30000); // 30秒发送一次心跳
    }
    
    // 发送数据到ESP32
    sendData(data) {
      if (!this.isConnected) {
        console.error('未连接到ESP32，无法发送数据');
        return false;
      }
      
      try {
        // 如果是对象，转换为JSON字符串
        const message = typeof data === 'object' ? JSON.stringify(data) : data;
        this.socket.send(message);
        console.log('已发送数据:', message);
        return true;
      } catch (e) {
        console.error('发送数据失败:', e);
        return false;
      }
    }
    
    // 发送命令到ESP32
    sendCommand(command, params = {}) {
      const data = {
        command,
        ...params,
        timestamp: Date.now()
      };
      
      return this.sendData(data);
    }
    
    // 注册数据接收回调
    onData(callback) {
      this.onDataCallbacks.push(callback);
      return this; // 支持链式调用
    }
    
    // 注册连接成功回调
    onConnect(callback) {
      this.onConnectCallbacks.push(callback);
      // 如果已经连接，立即调用回调
      if (this.isConnected) {
        callback();
      }
      return this; // 支持链式调用
    }
    
    // 注册断开连接回调
    onDisconnect(callback) {
      this.onDisconnectCallbacks.push(callback);
      return this; // 支持链式调用
    }
    
    // 断开连接
    disconnect() {
      this.isManualDisconnect = true; // 标记为主动断开
      
      // 清除定时器
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      
      if (this.socket) {
        try {
          this.socket.close(1000, '主动断开');
        } catch (e) {
          console.error('关闭连接时出错:', e);
        }
        this.socket = null;
      }
      
      this.isConnected = false;
      this.reconnectAttempts = 0;
      
      // 重置标记
      setTimeout(() => {
        this.isManualDisconnect = false;
      }, 1000);
    }
    
    // 重置重连计数器并重新连接
    resetAndReconnect() {
      // 清除定时器
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      
      this.reconnectAttempts = 0;
      
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          console.log('关闭现有连接时出错:', e);
        }
        this.socket = null;
      }
      
      // 等待短暂停后重连
      setTimeout(() => {
        this.connect();
      }, 1000);
    }
  }
  
  // 全局变量
  window.ESP32Connection = ESP32Connection;
  