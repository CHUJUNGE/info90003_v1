/**
 * gesture.js - 处理手势识别和匹配
 * 使用BLE连接与ESP32通信，接收MPU6050数据并进行手势匹配
 */

// 全局变量
let isRecording = false;
let currentData = [];
let currentActionType = 'cup'; // 默认动作类型：cup, knife, phone, monitor
let esp32Connection = null; // BLE连接对象
const MAX_SAMPLES = 20; // 保持与参考数据相同的数据点数量
let matchResult = { matchPercentage: 0, level: '未匹配' };
let isGestureUIInitialized = false;

// 全局函数：处理从MPU6050接收到的数据
window.processMPUData = function(payload) {
    console.log('处理MPU数据:', payload);
    
    // 如果不在记录状态，直接返回
    if (!isRecording) {
        console.log('当前不在记录状态，忽略MPU数据');
        return;
    }
    
    // 确保当前阶段已设置
    if (!window.currentStage) {
        // 尝试从URL或当前显示的容器推断当前阶段
        const containers = [
            'stage4-1-1-container',
            'stage4-2-1-container',
            'stage4-3-1-container',
            'stage4-4-1-container'
        ];
        
        for (const id of containers) {
            const container = document.getElementById(id);
            if (container && container.style.display !== 'none') {
                window.currentStage = id.replace('-container', '');
                console.log(`从容器推断当前阶段: ${window.currentStage}`);
                break;
            }
        }
        
        // 如果仍然无法确定阶段，默认为stage4-1-1
        if (!window.currentStage) {
            window.currentStage = 'stage4-1-1';
            console.log('无法确定当前阶段，默认设置为stage4-1-1');
        }
    }
    
    // 解析MPU数据
    let mpuData;
    
    if (typeof payload === 'string') {
        // 解析字符串格式的MPU数据，例如 'ax:10.01,ay:-0.69,az:3.05,gx:-0.44,gy:0.33,gz:-0.94'
        try {
            const parts = payload.split(',');
            const values = {};
            
            for (const part of parts) {
                const [key, value] = part.split(':');
                values[key] = parseFloat(value);
            }
            
            mpuData = {
                accel: {
                    x: values.ax || 0,
                    y: values.ay || 0,
                    z: values.az || 0
                },
                gyro: {
                    x: values.gx || 0,
                    y: values.gy || 0,
                    z: values.gz || 0
                },
                timestamp: Date.now()
            };
            
            console.log('解析的MPU数据:', mpuData);
        } catch (error) {
            console.error('解析MPU数据字符串时出错:', error, payload);
            return;
        }
    } else if (typeof payload === 'object') {
        // 如果已经是对象格式
        mpuData = {
            accel: {
                x: payload.ax || payload.accel?.x || 0,
                y: payload.ay || payload.accel?.y || 0,
                z: payload.az || payload.accel?.z || 0
            },
            gyro: {
                x: payload.gx || payload.gyro?.x || 0,
                y: payload.gy || payload.gyro?.y || 0,
                z: payload.gz || payload.gyro?.z || 0
            },
            timestamp: Date.now()
        };
    } else {
        console.error('无法识别的MPU数据格式:', payload);
        return;
    }
    
    // 将数据添加到当前数据数组
    currentData.push(mpuData);
    console.log(`已添加MPU数据到当前数据数组，当前长度: ${currentData.length}`);
    
    // 如果收集了足够的数据点，自动停止记录
    if (currentData.length >= MAX_SAMPLES) {
        console.log(`已收集${currentData.length}个数据点，自动停止记录`);
        finishRecording();
    }
};

// 不同动作的参考数据
const referenceGestures = {
  // 喝水动作参考数据
  cup: [
    [-9.75, -1.02, 0.57,  0.12,  0.35, -0.25],
    [-9.29, -1.71, 0.68, -0.02,  0.03, -0.09],
    [-9.27, -1.60, 1.02,  0.03, -0.21,  0.14],
    [-9.57, -1.23, 0.62,  0.07,  0.23,  0.24],
    [-9.47, -1.63, 0.58, -0.06,  0.05,  0.01],
    [-9.83, -1.13, 0.41, -0.17, -0.12, -0.06],
    [-10.55, -1.31, 0.63,  0.04,  0.06,  0.49],
    [-10.70, -0.50, 0.82,  0.17,  0.13,  1.06],
    [-9.27,  0.48, 0.28,  0.24,  0.09,  1.50],
    [-9.73,  1.85, 0.46,  0.31, -0.11,  1.19],
    [-9.11,  3.16, 0.50,  0.17, -0.17,  1.19],
    [-9.18,  4.19, 0.42,  0.09, -0.20,  1.36],
    [-7.73,  5.32, 0.24,  0.14, -0.08,  1.55],
    [-6.35,  6.20, 0.40,  0.05, -0.22,  1.11],
    [-5.74,  7.08, 0.48,  0.11, -0.29,  1.09],
    [-4.81,  7.78, 0.45,  0.08, -0.20,  1.05],
    [-3.68,  8.25, 0.36,  0.04, -0.21,  0.94],
    [-2.96,  8.13, 0.74,  0.21,  0.03,  1.18],
    [-1.25,  9.01, 0.76,  0.36, -0.11,  1.07],
    [-1.22, 9.28, -0.22, 0.14, -0.16, 0.45]
  ],
  
  // 刀动作参考数据 (示例数据，需要替换为实际的刀动作数据)
  knife: [
    [-8.75, -2.02, 1.57,  0.22,  0.45, -0.35],
    [-8.29, -2.71, 1.68, -0.12,  0.13, -0.19],
    [-8.27, -2.60, 2.02,  0.13, -0.31,  0.24],
    [-8.57, -2.23, 1.62,  0.17,  0.33,  0.34],
    [-8.47, -2.63, 1.58, -0.06,  0.15,  0.11],
    [-8.83, -2.13, 1.41, -0.17, -0.22, -0.16],
    [-9.55, -2.31, 1.63,  0.14,  0.16,  0.59],
    [-9.70, -1.50, 1.82,  0.27,  0.23,  1.06],
    [-8.27, -0.52, 1.28,  0.34,  0.19,  1.60],
    [-8.73,  0.85, 1.46,  0.41, -0.21,  1.29],
    [-8.11,  2.16, 1.50,  0.27, -0.27,  1.29],
    [-8.18,  3.19, 1.42,  0.19, -0.30,  1.36],
    [-6.73,  4.32, 1.24,  0.24, -0.18,  1.55],
    [-5.35,  5.20, 1.40,  0.15, -0.22,  1.11],
    [-4.74,  6.08, 1.48,  0.11, -0.29,  1.09],
    [-3.81,  6.78, 1.45,  0.08, -0.20,  1.05],
    [-2.68,  7.25, 1.36,  0.04, -0.21,  0.94],
    [-1.96,  7.13, 1.74,  0.21,  0.03,  1.18],
    [-0.25,  8.01, 1.76,  0.36, -0.11,  1.07],
    [-0.22,  8.28, 0.78,  0.14, -0.16,  0.45]
  ],
  
  // 手机动作参考数据 (示例数据，需要替换为实际的手机动作数据)
  phone: [
    [-7.75, -0.02, 2.57,  0.32,  0.55, -0.45],
    [-7.29, -0.71, 2.68,  0.08,  0.23, -0.29],
    [-7.27, -0.60, 3.02,  0.23, -0.41,  0.34],
    [-7.57, -0.23, 2.62,  0.27,  0.43,  0.44],
    [-7.47, -0.63, 2.58, -0.06,  0.25,  0.21],
    [-7.83, -0.13, 2.41, -0.17, -0.32, -0.26],
    [-8.55, -0.31, 2.63,  0.24,  0.26,  0.69],
    [-8.70,  0.50, 2.82,  0.37,  0.33,  1.26],
    [-7.27,  1.48, 2.28,  0.44,  0.29,  1.70],
    [-7.73,  2.85, 2.46,  0.51, -0.31,  1.39],
    [-7.11,  4.16, 2.50,  0.37, -0.37,  1.39],
    [-7.18,  5.19, 2.42,  0.29, -0.40,  1.46],
    [-5.73,  6.32, 2.24,  0.34, -0.28,  1.65],
    [-4.35,  7.20, 2.40,  0.25, -0.32,  1.21],
    [-3.74,  8.08, 2.48,  0.21, -0.39,  1.09],
    [-2.81,  8.78, 2.45,  0.18, -0.30,  1.05],
    [-1.68,  9.25, 2.36,  0.14, -0.31,  0.94],
    [-0.96,  9.13, 2.74,  0.21,  0.03,  1.08],
    [0.75,  10.01, 2.76,  0.36, -0.21,  1.07],
    [0.78,  10.28, 1.78,  0.14, -0.16,  0.45]
  ],
  
  // 监控器动作参考数据 (示例数据，需要替换为实际的监控器动作数据)
  monitor: [
    [-6.75,  1.02, 3.57,  0.42,  0.65, -0.55],
    [-6.29,  0.29, 3.68,  0.18,  0.33, -0.39],
    [-6.27,  0.40, 4.02,  0.33, -0.51,  0.44],
    [-6.57,  0.77, 3.62,  0.37,  0.53,  0.54],
    [-6.47,  0.37, 3.58,  0.04,  0.35,  0.31],
    [-6.83,  0.87, 3.41, -0.07, -0.42, -0.36],
    [-7.55,  0.69, 3.63,  0.34,  0.36,  0.79],
    [-7.70,  1.50, 3.82,  0.47,  0.43,  1.36],
    [-6.27,  2.48, 3.28,  0.54,  0.39,  1.80],
    [-6.73,  3.85, 3.46,  0.61, -0.41,  1.49],
    [-6.11,  5.16, 3.50,  0.47, -0.47,  1.49],
    [-6.18,  6.19, 3.42,  0.39, -0.50,  1.56],
    [-4.73,  7.32, 3.24,  0.44, -0.38,  1.75],
    [-3.35,  8.20, 3.40,  0.35, -0.52,  1.41],
    [-2.74,  9.08, 3.48,  0.31, -0.59,  1.39],
    [-1.81,  9.78, 3.45,  0.28, -0.50,  1.35],
    [-0.68, 10.25, 3.36,  0.24, -0.51,  1.24],
    [0.04, 10.13, 3.74,  0.31,  0.13,  1.28],
    [1.75, 11.01, 3.76,  0.41, -0.31,  1.17],
    [1.78, 11.28, 2.78,  0.24, -0.26,  0.75]
  ]
};

// 获取当前动作类型的参考数据
function getReferenceData(actionType) {
  const gestureData = referenceGestures[actionType] || referenceGestures.cup;
  return gestureData.map(data => ({
    accel: { x: data[0], y: data[1], z: data[2] },
    gyro: { x: data[3], y: data[4], z: data[5] }
  }));
}

function calculateDistance(data1, data2) {
    console.log('开始计算距离，数据长度:', data1 ? data1.length : 0, data2 ? data2.length : 0);
    
    // 检查数据是否有效
    if (!data1 || !data2 || !data1.length || !data2.length) {
        console.warn('数据无效，无法计算距离');
        return {
            matchPercentage: 50, // 返回一个默认值
            level: '数据不足'
        };
    }
    
    const length = Math.min(data1.length, data2.length);
    if (length === 0) {
        console.warn('数据长度为0，无法计算距离');
        return {
            matchPercentage: 50,
            level: '数据不足'
        };
    }
    
    let totalDiff = 0;
    
    // 计算参考动作的特征
    let referenceFeatures = {
        maxAccel: 0.001, // 避免除以0
        avgAccel: 0,
        directionChanges: 0,
        prevAccel: null
    };
    
    try {
        // 首先分析参考数据的特征
        for (let i = 0; i < data1.length; i++) {
            const p = data1[i];
            if (!p || !p.accel) {
                console.warn(`参考数据第${i}项无效`);
                continue;
            }
            
            const accelMag = Math.sqrt(
                Math.pow(p.accel.x || 0, 2) + 
                Math.pow(p.accel.y || 0, 2) + 
                Math.pow(p.accel.z || 0, 2)
            );
            
            referenceFeatures.maxAccel = Math.max(referenceFeatures.maxAccel, accelMag);
            referenceFeatures.avgAccel += accelMag;
            
            if (referenceFeatures.prevAccel !== null) {
                if (((p.accel.x || 0) * (referenceFeatures.prevAccel.x || 0) < 0) ||
                    ((p.accel.y || 0) * (referenceFeatures.prevAccel.y || 0) < 0) ||
                    ((p.accel.z || 0) * (referenceFeatures.prevAccel.z || 0) < 0)) {
                    referenceFeatures.directionChanges++;
                }
            }
            referenceFeatures.prevAccel = p.accel;
        }
        
        // 避免除以0
        referenceFeatures.avgAccel = referenceFeatures.avgAccel / data1.length || 0.001;
        
        // 计算测试数据与参考特征的差异
        for (let i = 0; i < length; i++) {
            const p1 = data1[i];
            const p2 = data2[i];
            
            if (!p1 || !p2 || !p1.accel || !p2.accel || !p1.gyro || !p2.gyro) {
                console.warn(`数据第${i}项无效，跳过`);
                continue;
            }
            
            // 加速度方向差异
            const accelDiff = Math.sqrt(
                Math.pow((p1.accel.x || 0) - (p2.accel.x || 0), 2) +
                Math.pow((p1.accel.y || 0) - (p2.accel.y || 0), 2) +
                Math.pow((p1.accel.z || 0) - (p2.accel.z || 0), 2)
            );
            
            // 将差异标准化，基于参考动作的特征
            const normalizedDiff = accelDiff / referenceFeatures.maxAccel;
            
            // 陀螺仪差异
            const gyroDiff = Math.sqrt(
                Math.pow((p1.gyro.x || 0) - (p2.gyro.x || 0), 2) +
                Math.pow((p1.gyro.y || 0) - (p2.gyro.y || 0), 2) +
                Math.pow((p1.gyro.z || 0) - (p2.gyro.z || 0), 2)
            );
            
            totalDiff += (normalizedDiff * 0.8 + gyroDiff * 0.2) * 10;
        }
        
        // 修改匹配度计算公式
        const normalizedTotalDiff = totalDiff / (length * referenceFeatures.avgAccel);
        const matchPercentage = 100 * Math.exp(-0.5 * normalizedTotalDiff);
        
        // 对匹配度进行非线性映射
        const adjustedMatchPercentage = matchPercentage < 40 ? 
            matchPercentage : 
            40 + (matchPercentage - 40) * 1.5;
        
        // 确保不超过100%
        const finalMatchPercentage = Math.min(100, adjustedMatchPercentage);
        
        console.log('=================');
        console.log('计算结果:');
        console.log(`原始匹配度: ${matchPercentage.toFixed(1)}%`);
        console.log(`调整后匹配度: ${finalMatchPercentage.toFixed(1)}%`);
        console.log(`评价: ${getMatchLevel(finalMatchPercentage)}`);
        console.log('=================');
        
        return {
            matchPercentage: finalMatchPercentage,
            level: getMatchLevel(finalMatchPercentage)
        };
    } catch (error) {
        console.error('计算距离时发生错误:', error);
        return {
            matchPercentage: 50,
            level: '计算错误'
        };
    }
}

// 修改评价等级判断
function getMatchLevel(percentage) {
    if (percentage >= 85) {         // 原来是90
        return '完美匹配';
    } else if (percentage >= 70) {  // 原来是75
        return '非常接近';
    } else if (percentage >= 55) {  // 原来是60
        return '基本接近';
    } else if (percentage >= 35) {  // 原来是40
        return '有些差异';
    } else {
        return '差异较大';
    }
}

// 处理来自ESP32的MPU6050数据
function processMPUData(data) {
    try {
        let ax, ay, az, gx, gy, gz;
        
        // 处理不同格式的数据
        if (typeof data === 'string') {
            // 字符串格式: "ax,ay,az,gx,gy,gz"
            const values = data.split(',').map(v => parseFloat(v.trim()));
            if (values.length === 6 && values.every(v => !isNaN(v))) {
                [ax, ay, az, gx, gy, gz] = values;
            } else {
                return; // 无效数据
            }
        } else if (typeof data === 'object') {
            // JSON格式: {accel: {x, y, z}, gyro: {x, y, z}}
            if (data.accel && data.gyro) {
                ax = data.accel.x;
                ay = data.accel.y;
                az = data.accel.z;
                gx = data.gyro.x;
                gy = data.gyro.y;
                gz = data.gyro.z;
            } else {
                return; // 无效数据
            }
        } else {
            return; // 未知数据格式
        }
        
        // 更新UI显示
        updateUI(ax, ay, az, gx, gy, gz);
        
        // 如果正在记录，保存数据点
        if (isRecording && currentData.length < MAX_SAMPLES) {
            console.log(`记录数据点 ${currentData.length + 1}/${MAX_SAMPLES}:`);
            console.log(`[${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}, ${gx.toFixed(2)}, ${gy.toFixed(2)}, ${gz.toFixed(2)}]`);
            
            currentData.push({
                accel: { x: ax, y: ay, z: az },
                gyro: { x: gx, y: gy, z: gz }
            });
            
            if (currentData.length === MAX_SAMPLES) {
                finishRecording();
            }
        }
    } catch (error) {
        console.error('处理MPU数据失败:', error);
    }
}

function updateUI(ax, ay, az, gx, gy, gz) {
    // 更新UI显示，根据当前页面号选择对应元素
    document.getElementById(`accelX${currentPageNumber}`).textContent = ax.toFixed(2);
    document.getElementById(`accelY${currentPageNumber}`).textContent = ay.toFixed(2);
    document.getElementById(`accelZ${currentPageNumber}`).textContent = az.toFixed(2);
    document.getElementById(`gyroX${currentPageNumber}`).textContent = gx.toFixed(2);
    document.getElementById(`gyroY${currentPageNumber}`).textContent = gy.toFixed(2);
    document.getElementById(`gyroZ${currentPageNumber}`).textContent = gz.toFixed(2);

    // 在控制台输出坐标数据
    console.log(`加速度: X=${ax.toFixed(2)}, Y=${ay.toFixed(2)}, Z=${az.toFixed(2)}`);
    console.log(`陀螺仪: X=${gx.toFixed(2)}, Y=${gy.toFixed(2)}, Z=${gz.toFixed(2)}`);
}

function updateProgressBar(percentage) {
    console.log(`更新进度条，当前阶段: ${window.currentStage}，匹配度: ${percentage}%`);
    
    // 使用当前阶段作为ID的一部分
    const progressFill = document.getElementById(`progressFill-${window.currentStage}`);
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
        progressFill.classList.remove('high', 'medium', 'low');
        
        // 根据匹配度设置颜色
        if (percentage >= 75) {
            progressFill.style.backgroundColor = '#00ff00'; // 高匹配度，绿色
            progressFill.classList.add('high');
        } else if (percentage >= 40) {
            progressFill.style.backgroundColor = '#ffcc00'; // 中匹配度，黄色
            progressFill.classList.add('medium');
        } else {
            progressFill.style.backgroundColor = '#ff3300'; // 低匹配度，红色
            progressFill.classList.add('low');
        }
        
        console.log(`进度条宽度已更新为 ${percentage}%`);
    } else {
        console.warn(`未找到进度条元素 progressFill-${window.currentStage}`);
    }
    
    const progressLabel = document.getElementById(`progressLabel-${window.currentStage}`);
    if (progressLabel) {
        progressLabel.textContent = `Match: ${percentage.toFixed(1)}%`;
        console.log(`进度标签已更新为 ${percentage.toFixed(1)}%`);
    } else {
        console.warn(`未找到进度标签元素 progressLabel-${window.currentStage}`);
    }
}

function finishRecording() {
    // 确保当前阶段已设置
    if (!window.currentStage) {
        // 尝试从URL或当前显示的容器推断当前阶段
        const containers = [
            'stage4-1-1-container',
            'stage4-2-1-container',
            'stage4-3-1-container',
            'stage4-4-1-container'
        ];
        
        for (const id of containers) {
            const container = document.getElementById(id);
            if (container && container.style.display !== 'none') {
                window.currentStage = id.replace('-container', '');
                console.log(`从容器推断当前阶段: ${window.currentStage}`);
                break;
            }
        }
        
        // 如果仍然无法确定阶段，默认为stage4-1-1
        if (!window.currentStage) {
            window.currentStage = 'stage4-1-1';
            console.log('无法确定当前阶段，默认设置为stage4-1-1');
        }
    }
    
    console.log('完成手势记录，当前阶段:', window.currentStage);
    isRecording = false;
    
    // 检查数据是否有效
    if (!currentData || currentData.length === 0) {
        console.warn('没有收集到有效的手势数据');
        matchResult = { matchPercentage: 50, level: '数据不足' };
        // 显示结果
        showMatchResultInStage();
        return;
    }
    
    // 获取当前动作类型的参考数据
    const referenceData = getReferenceData(currentActionType);
    console.log('当前动作类型:', currentActionType);
    console.log('当前数据长度:', currentData.length);
    
    // 计算匹配度
    matchResult = calculateDistance(referenceData, currentData);
    console.log('匹配结果:', matchResult);
    
    // 更新UI
    if (matchResult && typeof matchResult.matchPercentage === 'number' && !isNaN(matchResult.matchPercentage)) {
        updateProgressBar(matchResult.matchPercentage);
    } else {
        console.error('匹配结果无效，无法更新进度条');
        // 设置一个默认值
        matchResult = { matchPercentage: 50, level: '中等匹配' };
    }
    
    // 显示匹配结果
    showMatchResultInStage();
    
    // 设置 LED 为绿色常亮并震动马达
    try {
        const esp32Obj = window.esp32GlobalBLEConnection; // Use the new global reference

        if (esp32Obj && typeof esp32Obj.isConnected === 'function' && esp32Obj.isConnected() && typeof esp32Obj.sendCommand === 'function') {
            // 设置 LED 为绿色常亮 (L3)
            console.log('finishRecording: ESP32 (global ref) connected. Sending L3 (green LED) command.');
            esp32Obj.sendCommand('L3');
            
            // 添加200ms延迟再发送马达命令
            setTimeout(() => {
                // Re-check connection AND existence of esp32Obj on window
                const currentEsp32Obj = window.esp32GlobalBLEConnection;
                if (currentEsp32Obj && currentEsp32Obj.isConnected()) {
                    console.log('finishRecording: ESP32 (global ref) connected. Sending M2 (motor - double vibration) command.');
                    currentEsp32Obj.sendCommand('M2');
                } else {
                    console.warn('finishRecording: ESP32 (global ref) disconnected or unavailable before M1 command.');
                }
            }, 200); // Increased delay to 500ms for testing
        } else {
            if (!esp32Obj) {
                console.warn('finishRecording: window.esp32GlobalBLEConnection is not defined.');
            } else if (typeof esp32Obj.isConnected !== 'function') {
                console.warn('finishRecording: window.esp32GlobalBLEConnection.isConnected is not a function.');
            } else if (!esp32Obj.isConnected()) {
                console.warn('finishRecording: ESP32 (global ref) is not connected. Cannot send commands.');
            } else if (typeof esp32Obj.sendCommand !== 'function') {
                console.warn('finishRecording: window.esp32GlobalBLEConnection.sendCommand is not a function.');
            }
            console.log('finishRecording: Could not send L3/M1 commands due to connection or object issues (using global ref).');
        }
    } catch (error) {
        console.error('ESP32 操作失败:', error);
    }
    
    // 清空当前数据
    currentData = [];
    console.log('手势记录完成并重置');
}

// 在stage4-x-1阶段显示匹配结果
async function showMatchResultInStage() {
    console.log('开始显示手势匹配结果，当前阶段:', window.currentStage);
    console.log('匹配结果:', matchResult);
    
    // 根据不同的stage确定动作类型
    let actionMessage;
    let stageContainer;
    
    switch(window.currentStage) {
        case 'stage4-1-1':
            stageContainer = document.getElementById('stage4-1-1-container');
            actionMessage = document.getElementById('action-reproduction-message');
            currentActionType = 'cup';
            break;
        case 'stage4-2-1':
            stageContainer = document.getElementById('stage4-2-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-2-1');
            currentActionType = 'knife';
            break;
        case 'stage4-3-1':
            stageContainer = document.getElementById('stage4-3-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-3-1');
            currentActionType = 'phone';
            break;
        case 'stage4-4-1':
            stageContainer = document.getElementById('stage4-4-1-container');
            actionMessage = document.getElementById('action-reproduction-message-stage4-4-1');
            currentActionType = 'monitor';
            break;
        default:
            console.warn('当前不在相关阶段，无法显示匹配结果');
            return; // 不在相关阶段
    }
    
    // 显示匹配度容器
    const matchContainer = stageContainer.querySelector('.gesture-match-container');
    if (matchContainer) {
        matchContainer.style.display = 'block';
        console.log('显示匹配度容器');
    }
    
    console.log('当前容器元素:', stageContainer);
    console.log('动作消息元素:', actionMessage);
    
    if (!stageContainer) {
        console.error(`未找到 ${window.currentStage}-container 元素！`);
        return;
    }
    
    if (!actionMessage) {
        console.error(`未找到动作消息元素！`);
        // 尝试创建一个消息元素
        actionMessage = document.createElement('p');
        actionMessage.id = 'action-reproduction-message';
        actionMessage.style.fontSize = '1.5em';
        actionMessage.style.color = '#00ccff';
        actionMessage.style.textAlign = 'center';
        actionMessage.style.margin = '20px 0';
        stageContainer.appendChild(actionMessage);
        console.log('创建了新的动作消息元素');
    }
    
    // 清除可能存在的类
    actionMessage.classList.remove('perfect-match', 'basic-match');
    
    // 添加内联样式，确保样式生效
    const perfectMatchStyle = 'color: #00ff00; text-shadow: 0 0 10px rgba(0, 255, 0, 0.7); font-size: 0.5em; animation: pulse 2s infinite;';
    const basicMatchStyle = 'color: #ffcc00; text-shadow: 0 0 10px rgba(255, 204, 0, 0.7); font-size: 0.5em;';
    
    // 根据匹配度显示不同的消息
    if (matchResult.matchPercentage >= 70) {
        actionMessage.textContent = 'Perfect reproduction, memory fragment unlocked';
        actionMessage.classList.add('perfect-match');
        actionMessage.style = perfectMatchStyle;
        console.log('显示完美匹配消息');
    } else {
        actionMessage.textContent = 'Basic reproduction, memory fragment unlocked';
        actionMessage.classList.add('basic-match');
        actionMessage.style = basicMatchStyle;
        console.log('显示基本匹配消息');
    }
    
    // 更新进度条
    const progressFill = document.getElementById(`progressFill-${window.currentStage}`);
    const progressLabel = document.getElementById(`progressLabel-${window.currentStage}`);
    
    if (progressFill) {
        progressFill.style.width = `${matchResult.matchPercentage}%`;
        
        // 根据匹配度设置颜色
        progressFill.classList.remove('high', 'medium', 'low');
        if (matchResult.matchPercentage >= 75) {
            progressFill.style.backgroundColor = '#00ff00'; // 高匹配度，绿色
        } else if (matchResult.matchPercentage >= 40) {
            progressFill.style.backgroundColor = '#ffcc00'; // 中匹配度，黄色
        } else {
            progressFill.style.backgroundColor = '#ff3300'; // 低匹配度，红色
        }
        
        // 更新匹配度标签样式
        if (progressLabel) {
            progressLabel.textContent = `Match: ${matchResult.matchPercentage.toFixed(1)}%`;
            progressLabel.style.fontSize = '0.8em';
            progressLabel.style.fontFamily = 'Arial, sans-serif';
        }
        
        console.log(`更新进度条宽度为 ${matchResult.matchPercentage}%`);
    } else {
        console.warn(`未找到 progressFill-${window.currentStage} 元素！`);
    }
    
    console.log('手势匹配结果显示完成');
}

// 初始化手势识别UI
function initGestureUI() {
    console.log('开始初始化手势识别UI');
    
    if (isGestureUIInitialized) {
        console.log('手势识别UI已经初始化过，跳过');
        return;
    }
    
    // 为stage4-1-1添加匹配度显示元素
    const stage4_1_1Container = document.getElementById('stage4-1-1-container');
    console.log('stage4-1-1-container 元素:', stage4_1_1Container);
    
    if (stage4_1_1Container) {
        if (!stage4_1_1Container.querySelector('.gesture-match-container')) {
            console.log('为 stage4-1-1-container 创建匹配度显示元素');
            
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-stage4-1-1" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-stage4-1-1" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
                </div>
            `;
            
            stage4_1_1Container.appendChild(matchContainer);
            console.log('匹配度显示元素已添加到 stage4-1-1-container');
        } else {
            console.log('stage4-1-1-container 已经存在匹配度显示元素');
        }
    } else {
        console.error('未找到 stage4-1-1-container 元素！');
        
        // 如果元素不存在，尝试创建它
        const stageElementsContainer = document.getElementById('stage-elements-container');
        if (stageElementsContainer) {
            console.log('尝试创建 stage4-1-1-container 元素');
            
            const newContainer = document.createElement('div');
            newContainer.id = 'stage4-1-1-container';
            newContainer.className = 'stage-message';
            newContainer.style.display = 'none';
            newContainer.style.flexDirection = 'column';
            newContainer.style.alignItems = 'center';
            newContainer.style.justifyContent = 'center';
            newContainer.style.textAlign = 'center';
            newContainer.style.height = '100%';
            
            const actionMessage = document.createElement('p');
            actionMessage.id = 'action-reproduction-message';
            actionMessage.textContent = 'Please reproduce the action';
            
            newContainer.appendChild(actionMessage);
            stageElementsContainer.appendChild(newContainer);
            
            console.log('stage4-1-1-container 元素已创建');
            
            // 再次尝试添加匹配度显示元素
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-stage4-1-1" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-stage4-1-1" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
                </div>
            `;
            
            newContainer.appendChild(matchContainer);
            console.log('匹配度显示元素已添加到新创建的 stage4-1-1-container');
        } else {
            console.error('未找到 stage-elements-container 元素，无法创建 UI 元素！');
        }
    }
    
    // 为其他stage4-x-1添加类似的匹配度显示元素
    ['stage4-2-1', 'stage4-3-1', 'stage4-4-1'].forEach(stageId => {
        const stageContainer = document.getElementById(`${stageId}-container`);
        console.log(`${stageId}-container 元素:`, stageContainer);
        
        if (stageContainer && !stageContainer.querySelector('.gesture-match-container')) {
            console.log(`为 ${stageId}-container 创建匹配度显示元素`);
            
            const matchContainer = document.createElement('div');
            matchContainer.className = 'gesture-match-container';
            matchContainer.style.width = '80%';
            matchContainer.style.maxWidth = '500px';
            matchContainer.style.margin = '20px auto';
            matchContainer.style.padding = '10px';
            matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
            matchContainer.style.border = '1px solid #00ccff';
            matchContainer.style.borderRadius = '8px';
            matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
            
            matchContainer.innerHTML = `
                <div class="progress-container" style="margin: 10px 0;">
                    <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                        <div id="progressFill-${stageId}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <div id="progressLabel-${stageId}" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif; display: none;">Match: 0%</div>
                </div>
            `;
            
            stageContainer.appendChild(matchContainer);
            console.log(`匹配度显示元素已添加到 ${stageId}-container`);
        }
    });
    
    // 创建手势匹配度显示元素
    const stages = ['stage4-1-1', 'stage4-2-1', 'stage4-3-1', 'stage4-4-1'];
    
    for (const stage of stages) {
        const container = document.getElementById(`${stage}-container`);
        if (!container) {
            console.warn(`未找到 ${stage}-container 元素，无法初始化手势识别UI`);
            continue;
        }
        
        // 检查是否已经创建了匹配度显示元素
        if (container.querySelector('.gesture-match-container')) {
            console.log(`${stage} 匹配度显示元素已存在`);
            continue;
        }
        
        // 创建匹配度显示元素
        const matchContainer = document.createElement('div');
        matchContainer.className = 'gesture-match-container';
        matchContainer.style.width = '80%';
        matchContainer.style.maxWidth = '500px';
        matchContainer.style.margin = '20px auto';
        matchContainer.style.padding = '10px';
        matchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
        matchContainer.style.border = '1px solid #00ccff';
        matchContainer.style.borderRadius = '8px';
        matchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
        
        matchContainer.innerHTML = `
            <div class="progress-container" style="margin: 10px 0;">
                <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                    <div id="progressFill-${stage}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                </div>
                <div id="progressLabel-${stage}" class="progress-label" style="margin-top: 5px; font-size: 1em; color: #00ccff; text-align: center; font-family: 'Orbitron', sans-serif;">Match: 0%</div>
            </div>
        `;
        
        container.appendChild(matchContainer);
        console.log(`为 ${stage} 创建了手势匹配度显示元素`);
    }
    
    // 添加全局MPU数据处理函数
    window.processMPUDataFromESP32 = function(data) {
        console.log('全局MPU数据处理函数被调用:', data);
        
        // 如果是字符串类型的MPU数据，则处理它
        if (data && data.type === 'mpu_string' && data.payload && typeof data.payload === 'string' && data.payload.includes('ax:')) {
            // 直接调用全局处理函数
            window.processMPUData(data.payload);
        }
    };
    
    isGestureUIInitialized = true;
    console.log('手势识别UI初始化完成');
}

// 事件监听器
document.addEventListener('DOMContentLoaded', async () => {
    console.log('手势识别模块初始化...');
    
    // 初始化UI元素
    initGestureUI();
    
    // 仅使用HTML中已经初始化的ESP32连接
    if (window.esp32Connection) {
        console.log('使用HTML中已初始化的ESP32连接对象');
        esp32Connection = window.esp32Connection;
        
        // 添加数据监听器
        esp32Connection.onData((data) => {
            console.log('从 ESP32 接收到数据:', data);
            if (data.type === 'mpu' || data.type === 'mpu_string') {
                processMPUData(data.payload);
            }
        });
    } else {
        console.warn('HTML中没有初始化ESP32连接，手势识别功能可能无法正常工作');
    }
    
    // 处理从MPU6050接收到的数据
    function processMPUData(payload) {
        // 如果不在记录状态，直接返回
        if (!isRecording) return;
        
        // 确保当前阶段已设置
        if (!window.currentStage) {
            // 尝试从URL或当前显示的容器推断当前阶段
            const containers = [
                'stage4-1-1-container',
                'stage4-2-1-container',
                'stage4-3-1-container',
                'stage4-4-1-container'
            ];
            
            for (const id of containers) {
                const container = document.getElementById(id);
                if (container && container.style.display !== 'none') {
                    window.currentStage = id.replace('-container', '');
                    console.log(`从容器推断当前阶段: ${window.currentStage}`);
                    break;
                }
            }
            
            // 如果仍然无法确定阶段，默认为stage4-1-1
            if (!window.currentStage) {
                window.currentStage = 'stage4-1-1';
                console.log('无法确定当前阶段，默认设置为stage4-1-1');
            }
        }
        
        // 解析MPU数据
        let mpuData;
        
        if (typeof payload === 'string') {
            // 解析字符串格式的MPU数据，例如 'ax:10.01,ay:-0.69,az:3.05,gx:-0.44,gy:0.33,gz:-0.94'
            try {
                const parts = payload.split(',');
                const values = {};
                
                for (const part of parts) {
                    const [key, value] = part.split(':');
                    values[key] = parseFloat(value);
                }
                
                mpuData = {
                    accel: {
                        x: values.ax || 0,
                        y: values.ay || 0,
                        z: values.az || 0
                    },
                    gyro: {
                        x: values.gx || 0,
                        y: values.gy || 0,
                        z: values.gz || 0
                    },
                    timestamp: Date.now()
                };
            } catch (error) {
                console.error('解析MPU数据字符串时出错:', error, payload);
                return;
            }
        } else if (typeof payload === 'object') {
            // 如果已经是对象格式
            mpuData = {
                accel: {
                    x: payload.ax || payload.accel?.x || 0,
                    y: payload.ay || payload.accel?.y || 0,
                    z: payload.az || payload.accel?.z || 0
                },
                gyro: {
                    x: payload.gx || payload.gyro?.x || 0,
                    y: payload.gy || payload.gyro?.y || 0,
                    z: payload.gz || payload.gyro?.z || 0
                },
                timestamp: Date.now()
            };
        } else {
            console.error('无法识别的MPU数据格式:', payload);
            return;
        }
        
        // 将数据添加到当前数据数组
        currentData.push(mpuData);
        
        // 如果收集了足够的数据点，自动停止记录
        if (currentData.length >= 100) {
            console.log(`已收集${currentData.length}个数据点，自动停止记录`);
            finishRecording();
        }
    }
    
    // 监听 stage 变化
    document.addEventListener('stageChange', (event) => {
        const newStage = event.detail.stage;
        console.log(`Stage 变化: ${newStage}`);
        
        // 更新全局当前阶段变量
        window.currentStage = newStage;
        
        // 在 action reproduction 阶段自动开始记录
        if (newStage === 'stage4-1-1' || 
            newStage === 'stage4-2-1' || 
            newStage === 'stage4-3-1' || 
            newStage === 'stage4-4-1') {
            
            // 设置当前动作类型
            if (newStage === 'stage4-1-1') currentActionType = 'cup';
            else if (newStage === 'stage4-2-1') currentActionType = 'knife';
            else if (newStage === 'stage4-3-1') currentActionType = 'phone';
            else if (newStage === 'stage4-4-1') currentActionType = 'monitor';
            
            console.log(`开始记录 ${currentActionType} 动作数据...`);
            
            // 清空当前数据并开始记录
            currentData = [];
            isRecording = true;
            
            // 重置匹配度显示
            const progressFill = document.getElementById(`progressFill-${newStage}`);
            const progressLabel = document.getElementById(`progressLabel-${newStage}`);
            
            if (progressFill) {
                progressFill.style.width = '0%';
                console.log(`重置 ${newStage} 进度条`);
            } else {
                console.warn(`未找到 ${newStage} 进度条元素`);
                // 尝试再次初始化 UI
                initGestureUI();
            }
            
            if (progressLabel) {
                progressLabel.textContent = 'Match: 0%';
            }
            
            // 手动触发一次 UI 更新，确保元素可见但隐藏匹配度容器
            const container = document.getElementById(`${newStage}-container`);
            if (container) {
                // 获取匹配度显示元素，并设置为隐藏
                const matchContainer = container.querySelector('.gesture-match-container');
                if (matchContainer) {
                    matchContainer.style.display = 'none';
                    console.log(`${newStage} 匹配度显示元素已设置为隐藏`);
                } else {
                    console.warn(`${newStage} 匹配度显示元素不存在，尝试重新创建`);
                    // 尝试为当前阶段创建匹配度显示元素
                    const newMatchContainer = document.createElement('div');
                    newMatchContainer.className = 'gesture-match-container';
                    newMatchContainer.style.width = '80%';
                    newMatchContainer.style.maxWidth = '500px';
                    newMatchContainer.style.margin = '20px auto';
                    newMatchContainer.style.padding = '10px';
                    newMatchContainer.style.backgroundColor = 'rgba(0, 20, 40, 0.7)';
                    newMatchContainer.style.border = '1px solid #00ccff';
                    newMatchContainer.style.borderRadius = '8px';
                    newMatchContainer.style.boxShadow = '0 0 15px rgba(0, 204, 255, 0.5)';
                    newMatchContainer.style.display = 'none'; // 初始状态为隐藏
                    
                    newMatchContainer.innerHTML = `
                        <div class="progress-container" style="margin: 10px 0;">
                            <div class="progress-bar" style="width: 100%; height: 20px; background-color: rgba(0, 0, 0, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(0, 204, 255, 0.3);">
                                <div id="progressFill-${newStage}" class="progress-fill" style="height: 100%; width: 0%; background-color: #00ccff; transition: width 0.5s ease-in-out;"></div>
                            </div>
                            <div id="progressLabel-${newStage}" class="progress-label" style="margin-top: 5px; font-size: 0.8em; color: #00ccff; text-align: center; font-family: 'Arial', sans-serif;">Match: 0%</div>
                        </div>
                    `;
                    
                    container.appendChild(newMatchContainer);
                    console.log(`为 ${newStage} 创建了新的匹配度显示元素`);
                }
            } else {
                console.error(`未找到 ${newStage}-container 元素！`);
            }
        } else {
            // 在其他阶段停止记录
            isRecording = false;
        }
    });
    
    // 手动触发一次 stageChange 事件，如果当前已经在 stage4-1-1 阶段
    if (window.currentStage === 'stage4-1-1') {
        console.log('当前已经在 stage4-1-1 阶段，手动触发 stageChange 事件');
        const stageChangeEvent = new CustomEvent('stageChange', { 
            detail: { stage: 'stage4-1-1', actionType: 'cup' } 
        });
        document.dispatchEvent(stageChangeEvent);
    }
});

// 暴露给全局的API
window.GestureRecognition = {
    startRecording: function(actionType) {
        currentActionType = actionType || 'cup';
        currentData = [];
        isRecording = true;
        console.log(`手动开始记录${currentActionType}动作...`);
        return true;
    },
    
    stopRecording: function() {
        if (!isRecording) return false;
        finishRecording();
        return matchResult;
    },
    
    getLastMatchResult: function() {
        return matchResult;
    },
    
    setActionType: function(actionType) {
        if (['cup', 'knife', 'phone', 'monitor'].includes(actionType)) {
            currentActionType = actionType;
            return true;
        }
        return false;
    }
};