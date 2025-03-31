#!/usr/bin/env node

/**
 * Traefik Monitoring Script
 * 
 * This script checks the health of Traefik and deployed applications,
 * sending alerts if issues are detected.
 * 
 * Features:
 * - Health endpoint monitoring
 * - Certificate expiration checks
 * - Response time monitoring
 * - Basic metrics collection
 * - Console reporting
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');


const config = {

  services: [
    { 
      name: 'Traefik Dashboard', 
      url: 'https://traefik.propertyapp.duckdns.org/dashboard/',
      expectedStatus: 200,
      timeout: 5000 // ms
    },
    { 
      name: 'NASA App', 
      url: 'https://majortomtogroundcontrol.duckdns.org',
      expectedStatus: 200,
      timeout: 5000 
    },
    { 
      name: 'Property App Frontend', 
      url: 'https://propertyapp.duckdns.org',
      expectedStatus: 200,
      timeout: 5000 
    },
    { 
      name: 'Property App API', 
      url: 'https://propertyapp.duckdns.org/api/repair/users',
      expectedStatus: 200,
      timeout: 5000 
    }
  ],

  thresholds: {
    responseTime: 1500, // Alert if response time > 1500ms
    certExpirationDays: 14 // Alert if cert expires in less than 14 days
  },
  
  metricsFile: './monitoring_metrics.json',
  
  checkInterval: 300000 // 5 minutes
};


let metrics = {
  lastCheck: null,
  services: {},
  alerts: []
};


try {
  if (fs.existsSync(config.metricsFile)) {
    metrics = JSON.parse(fs.readFileSync(config.metricsFile));
  }
} catch (err) {
  console.error(`Error loading metrics file: ${err.message}`);
}


async function checkService(service) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const requester = service.url.startsWith('https') ? https : http;
    
    const timeout = setTimeout(() => {
      resolve({
        name: service.name,
        url: service.url,
        status: 'TIMEOUT',
        responseTime: config.thresholds.responseTime + 1,
        error: 'Request timed out'
      });
    }, service.timeout);

    const req = requester.get(service.url, { rejectUnauthorized: false }, (res) => {
      clearTimeout(timeout);
      
      const responseTime = Date.now() - startTime;

      let certInfo = null;
      if (service.url.startsWith('https') && res.socket && res.socket.getPeerCertificate) {
        const cert = res.socket.getPeerCertificate();
        if (cert && cert.valid_to) {
          const expirationDate = new Date(cert.valid_to);
          const daysToExpiration = Math.ceil((expirationDate - new Date()) / (1000 * 60 * 60 * 24));
          
          certInfo = {
            issuer: cert.issuer?.CN || 'Unknown',
            expirationDate: expirationDate.toISOString(),
            daysToExpiration
          };
        }
      }

      const status = res.statusCode === service.expectedStatus ? 'HEALTHY' : 'UNHEALTHY';
      
      resolve({
        name: service.name,
        url: service.url,
        status,
        statusCode: res.statusCode,
        responseTime,
        certificate: certInfo,
        timestamp: new Date().toISOString()
      });
    });
    
    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        name: service.name,
        url: service.url,
        status: 'ERROR',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    });
  });
}

function checkContainers() {
  return new Promise((resolve) => {
    exec('docker ps --format "{{.Names}}: {{.Status}}"', (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message });
        return;
      }
      
      const containers = {};
      stdout.trim().split('\n').forEach(line => {
        const [name, status] = line.split(': ');
        containers[name] = status;
      });
      
      resolve({ containers });
    });
  });
}

function generateAlerts(serviceResults, containerStatus) {
  const alerts = [];
  
  serviceResults.forEach(result => {
    if (result.status === 'ERROR' || result.status === 'UNHEALTHY' || result.status === 'TIMEOUT') {
      alerts.push({
        level: 'HIGH',
        service: result.name,
        message: `${result.name} is ${result.status}: ${result.error || result.statusCode}`,
        timestamp: new Date().toISOString()
      });
    }
    if (result.responseTime > config.thresholds.responseTime) {
      alerts.push({
        level: 'MEDIUM',
        service: result.name,
        message: `${result.name} response time (${result.responseTime}ms) exceeds threshold (${config.thresholds.responseTime}ms)`,
        timestamp: new Date().toISOString()
      });
    }

    if (result.certificate && result.certificate.daysToExpiration < config.thresholds.certExpirationDays) {
      alerts.push({
        level: 'HIGH',
        service: result.name,
        message: `SSL Certificate for ${result.name} expires in ${result.certificate.daysToExpiration} days`,
        timestamp: new Date().toISOString()
      });
    }
  });

  if (containerStatus.containers) {
    Object.entries(containerStatus.containers).forEach(([name, status]) => {
      if (!status.includes('Up ')) {
        alerts.push({
          level: 'HIGH',
          service: name,
          message: `Container ${name} is not running: ${status}`,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  
  return alerts;
}

async function runCheck() {
  console.log(`\n[${new Date().toISOString()}] Running monitoring check...`);
  
  const servicePromises = config.services.map(service => checkService(service));
  const serviceResults = await Promise.all(servicePromises);
  
  const containerStatus = await checkContainers();

  const currentAlerts = generateAlerts(serviceResults, containerStatus);
  
  metrics.lastCheck = new Date().toISOString();
  serviceResults.forEach(result => {
    metrics.services[result.name] = result;
  });
  metrics.containerStatus = containerStatus.containers;
  metrics.alerts = currentAlerts;

  fs.writeFileSync(config.metricsFile, JSON.stringify(metrics, null, 2));
  
  console.log('\n--- SERVICE STATUS ---');
  serviceResults.forEach(result => {
    const statusColor = result.status === 'HEALTHY' ? '\x1b[32m' : '\x1b[31m'; // Green vs Red
    console.log(`${statusColor}${result.name}\x1b[0m: ${result.status} ${result.responseTime ? `(${result.responseTime}ms)` : ''}`);
    
    if (result.certificate) {
      const certColor = result.certificate.daysToExpiration < config.thresholds.certExpirationDays ? '\x1b[33m' : '\x1b[32m';
      console.log(`  Certificate: Expires in ${certColor}${result.certificate.daysToExpiration}\x1b[0m days`);
    }
    
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  });
  
  console.log('\n--- CONTAINER STATUS ---');
  if (containerStatus.containers) {
    Object.entries(containerStatus.containers).forEach(([name, status]) => {
      const statusColor = status.includes('Up ') ? '\x1b[32m' : '\x1b[31m';
      console.log(`${statusColor}${name}\x1b[0m: ${status}`);
    });
  } else if (containerStatus.error) {
    console.log(`Error: ${containerStatus.error}`);
  }

  if (currentAlerts.length > 0) {
    console.log('\n--- ALERTS ---');
    currentAlerts.forEach(alert => {
      const levelColor = alert.level === 'HIGH' ? '\x1b[31m' : '\x1b[33m';
      console.log(`${levelColor}[${alert.level}]\x1b[0m ${alert.service}: ${alert.message}`);
    });
  } else {
    console.log('\n✅ All systems operational');
  }
}

runCheck();
setInterval(runCheck, config.checkInterval);

console.log(`Monitoring started. Checking every ${config.checkInterval / 1000} seconds.`);
console.log(`Metrics will be saved to ${config.metricsFile}`);