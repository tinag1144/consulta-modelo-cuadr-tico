# 🌸 Sistema Distribuido con Caché Redis
### Calculadora con `y = 2x² + 5x + 3` — Arquitectura en 3 VMs

> **Alumna:** Gonzalez, Agostina

---

## 📋 Descripción General

Sistema distribuido de tres capas que calcula la función `y = 2x² + 5x + 3` optimizando el cómputo mediante una capa de caché en memoria (Redis). La primera vez que se consulta un valor de X se calcula y guarda en Redis; las siguientes veces se responde directo desde el caché.

| VM  | Rol                  | IP Interna       | Puerto | SSH Anfitrión |
|-----|----------------------|------------------|--------|---------------|
| VM1 | Caché — Redis        | 192.168.100.10   | 6379   | 2221          |
| VM2 | Backend — Node.js    | 192.168.100.20   | 3000   | 2222          |
| VM3 | Frontend — Apache    | 192.168.100.30   | 8080   | 2223          |

---

## 🔄 Flujo de Datos

```
Usuario (navegador)
       ↓  http://localhost:8080
   VM3 — Frontend (Apache)
       ↓  http://192.168.100.20:3000/calcular?x=X
   VM2 — Backend (Node.js)
       ↓  consulta Redis
   VM1 — Caché (Redis :6379)
       ↑  CACHE HIT  → devuelve resultado guardado
       ↑  CACHE MISS → calcula, guarda en Redis, devuelve
```

---

## 🛠️ FASE 1 — Infraestructura VirtualBox

### Crear las 3 VMs

Crear 3 máquinas virtuales con **Ubuntu Server 22.04 LTS** (o superior). Para cada una:

1. VirtualBox → **Nueva**
2. Nombre: `VM1-Redis`, `VM2-Backend`, `VM3-Frontend`
3. Tipo: **Linux** / Versión: **Ubuntu 64-bit**
4. RAM: **1024 MB** mínimo
5. Disco: **10 GB** (reservado dinámicamente)

### Configuración de red — 2 adaptadores por VM ⚠️

Hacer esto en **cada VM** antes de encenderlas:

**Adaptador 1 → NAT** (para internet y SSH desde la PC)
- Configuración → Red → Adaptador 1 → Conectado a: **NAT**
- Expandir **Avanzado** → Reenvío de puertos (agregar según tabla abajo)

**Adaptador 2 → Red Interna** (para comunicación entre VMs)
- Configuración → Red → Adaptador 2 → Conectado a: **Red interna**
- Nombre de red: `intnet`
- En **Avanzado**: Modo promiscuo = **"Permitir todo"** y tildar **"Cable conectado"**

### Reenvío de puertos (Adaptador 1 — NAT de cada VM)

**VM1:**
| Nombre | Protocolo | Puerto Anfitrión | Puerto Invitado |
|--------|-----------|-----------------|-----------------|
| SSH    | TCP       | 2221             | 22              |
| Redis  | TCP       | 6379             | 6379            |

**VM2:**
| Nombre  | Protocolo | Puerto Anfitrión | Puerto Invitado |
|---------|-----------|-----------------|-----------------|
| SSH     | TCP       | 2222             | 22              |
| Backend | TCP       | 3000             | 3000            |

**VM3:**
| Nombre   | Protocolo | Puerto Anfitrión | Puerto Invitado |
|----------|-----------|-----------------|-----------------|
| SSH      | TCP       | 2223             | 22              |
| Frontend | TCP       | 8080             | 8080            |

### Instalar Ubuntu Server

1. Seleccioná la VM → **Configuración → Almacenamiento** → montar el ISO
2. Iniciar la VM y seguir el instalador:
   - Language: **English**
   - Keyboard: el tuyo
   - Type: **Ubuntu Server**
   - Storage: **Use entire disk**
   - Profile: usuario `alumno`, contraseña `alumno123`
   - ✅ **Install OpenSSH server** (marcar con espacio)
3. Al terminar → **Reboot Now**

Conectarse por SSH desde la PC (una vez que la VM arrancó):
```bash
# VM1
ssh -p 2221 alumno@localhost

# VM2
ssh -p 2222 alumno@localhost

# VM3
ssh -p 2223 alumno@localhost
```

### Desactivar cloud-init (arranque más rápido)

Ejecutar en las **3 VMs**:

```bash
sudo touch /etc/cloud/cloud-init.disabled
sudo systemctl disable cloud-init cloud-config cloud-final cloud-init-local
sudo systemctl mask cloud-init
sudo systemctl disable systemd-networkd-wait-online.service
sudo systemctl mask systemd-networkd-wait-online.service
```

---

## 💾 FASE 2 — VM1: Servidor Redis (Caché)

> Conectarse: `ssh -p 2221 alumno@localhost`

### 1. Levantar la interfaz de red interna

Al iniciar la VM las tarjetas suelen estar inactivas. Levantarlas y asignar IP estática:

```bash
sudo ip link set enp0s3 up
sudo ip link set enp0s8 up
sudo ip addr add 192.168.100.10/24 dev enp0s8
```

> ⚠️ Estas IPs manuales no persisten al reiniciar. Para hacerlas permanentes ver la sección de Netplan al final.

### 2. Instalar Redis

```bash
sudo apt update && sudo apt install -y redis-server
sudo systemctl enable redis-server && sudo systemctl start redis-server
```

### 3. Abrir Redis para conexiones externas

Por defecto Redis solo acepta conexiones locales. Editamos su configuración:

```bash
sudo nano /etc/redis/redis.conf
```

> ⚠️ En algunas distribuciones el archivo puede llamarse `/etc/redis/redis.config`

Buscar (Ctrl+W) y modificar/agregar estas directivas:

```
bind 0.0.0.0
protected-mode no
port 6379
supervised systemd
dir /var/lib/redis
```

Guardar (**Ctrl+O → Enter → Ctrl+X**), reiniciar y abrir el firewall:

```bash
sudo systemctl restart redis-server
sudo ufw allow 6379/tcp
```

**Verificación:**
```bash
sudo ss -lnpt | grep 6379
# Debe mostrar: LISTEN 0.0.0.0:6379
```

**Probar que Redis responde:**
```bash
redis-cli ping
# Respuesta esperada: PONG
```

---

## ⚙️ FASE 3 — VM2: Backend Node.js

> Conectarse: `ssh -p 2222 alumno@localhost`

### 1. Levantar la red interna

```bash
sudo ip link set enp0s8 up
sudo ip addr add 192.168.100.20/24 dev enp0s8
```

### 2. Instalar Node.js

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # debe mostrar v20.x.x
```

### 3. Crear el proyecto e instalar dependencias

```bash
mkdir -p ~/backend && cd ~/backend
npm init -y
npm install express cors ioredis
```

### 4. Crear el servidor `index.js`

```bash
nano index.js
```

Pegar el siguiente código completo:

```javascript
const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const app = express();

app.use(cors());
app.use(express.json());

// Conexión al servidor Redis remoto (VM1)
const redis = new Redis({ host: '192.168.100.10', port: 6379 });
redis.on('connect', () => console.log('Conectado a Redis en VM1'));

function calcular(x) { return 2 * x * x + 5 * x + 3; }

app.get('/calcular', async (req, res) => {
  const x = parseFloat(req.query.x);
  if (isNaN(x)) return res.status(400).json({ error: 'x debe ser un numero' });

  const clave = `resultado:${x}`;
  const cached = await redis.get(clave);

  if (cached !== null) {
    console.log(`Cache HIT para x=${x}`);
    return res.json({ x, y: parseFloat(cached), fuente: 'cache', mensaje: 'Resultado obtenido del cache' });
  }

  console.log(`Cache MISS para x=${x}, calculando...`);
  const y = calcular(x);
  await redis.set(clave, y, 'EX', 3600); // Guarda en VM1 con 1 hora de expiración
  return res.json({ x, y, fuente: 'calculo', mensaje: 'Resultado calculado y guardado en cache' });
});

app.get('/cache/limpiar', async (req, res) => {
  const claves = await redis.keys('resultado:*');
  for (const clave of claves) await redis.del(clave);
  res.json({ mensaje: `Cache limpiado. Se borraron ${claves.length} entradas.` });
});

app.listen(3000, () => console.log('Backend corriendo en puerto 3000'));
```

Guardar (**Ctrl+O → Enter → Ctrl+X**).

### 5. Probar el backend

```bash
node index.js
# Debe mostrar:
# Backend corriendo en puerto 3000
# Conectado a Redis en VM1
```

> ⚠️ Si aparece `ECONNREFUSED` al conectar con Redis: verificar que VM1 esté encendida y que `enp0s8` de VM1 tenga la IP `192.168.100.10`

Para dejarlo corriendo en segundo plano (sin cerrar al salir de SSH):

```bash
node index.js &
```

---

## 🎨 FASE 4 — VM3: Frontend Apache

> Conectarse: `ssh -p 2223 alumno@localhost`

### 1. Configuración persistente de red con Netplan

Para que la IP de la red interna sobreviva a los reinicios:

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

Pegar con **indentación de espacios** (nunca tabs):

```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      addresses: [192.168.100.30/24]
```

Aplicar:

```bash
sudo netplan apply
```

### 2. Instalar Apache y configurar puerto 8080

```bash
sudo apt update && sudo apt install -y apache2
```

Cambiar el puerto por defecto (80 → 8080):

```bash
sudo nano /etc/apache2/ports.conf
# Cambiar: Listen 80 → Listen 8080

sudo nano /etc/apache2/sites-enabled/000-default.conf
# Cambiar: <VirtualHost *:80> → <VirtualHost *:8080>

sudo systemctl restart apache2
```

### 3. Crear el frontend `index.html`

```bash
sudo mkdir -p /var/www/html/Sistema
sudo nano /var/www/html/Sistema/index.html
```

Pegar el siguiente código completo:

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Calculadora con Cache ✨</title>
    <style>
        :root {
            --rosa-pastel: #ffe5ec; --rosa-medio: #ffb3c6; --rosa-fuerte: #ff7096; --rosa-oscuro: #ff477e; --texto: #4a1525;
        }
        body {
            font-family: 'Segoe UI', sans-serif; background-color: var(--rosa-pastel); color: var(--texto);
            display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0;
        }
        .container {
            background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 25px rgba(255, 112, 150, 0.2);
            width: 380px; text-align: center; border: 3px solid var(--rosa-medio);
        }
        h1 { color: var(--rosa-oscuro); font-size: 24px; }
        input { width: 80%; padding: 12px; border: 2px solid var(--rosa-medio); border-radius: 10px; text-align: center; }
        button { width: 88%; padding: 12px; background-color: var(--rosa-fuerte); color: white; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; margin-bottom: 10px; }
        button:hover { background-color: var(--rosa-oscuro); }
        .btn-secundario { background-color: transparent; color: var(--rosa-fuerte); border: 2px solid var(--rosa-fuerte); }
        .resultado-box { margin-top: 25px; padding: 15px; border-radius: 10px; background-color: var(--rosa-pastel); border: 1px dashed var(--rosa-fuerte); display: none; }
        .badge { display: inline-block; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-top: 10px; }
        .hit  { background-color: #d4edda; color: #155724; }
        .miss { background-color: #fff3cd; color: #856404; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Calculadora Mágica 💕</h1>
        <div style="font-style: italic; color: var(--rosa-fuerte); margin-bottom: 25px;">y = 2x^2 + 5x + 3</div>
        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">Ingresá el valor de X:</label>
            <input type="number" id="valorX" value="5">
        </div>
        <button onclick="enviarCalculo()">Calcular ✨</button>
        <button class="btn-secundario" onclick="limpiarCache()">Limpiar Caché 🧹</button>
        <div id="resultadoBox" class="resultado-box">
            <div style="font-size: 18px;">Resultado (Y): <strong id="resY">-</strong></div>
            <div id="badgeFuente" class="badge"></div>
            <p id="resMensaje" style="font-size: 13px; margin: 10px 0 0 0;"></p>
        </div>
    </div>
    <script>
        const API_URL = 'http://192.168.100.20:3000';

        async function enviarCalculo() {
            const x = document.getElementById('valorX').value;
            if (!x) return alert('Por favor poné un número');
            try {
                const response = await fetch(`${API_URL}/calcular?x=${x}`);
                const data = await response.json();
                document.getElementById('resY').innerText = data.y;
                document.getElementById('resMensaje').innerText = data.mensaje;
                const badge = document.getElementById('badgeFuente');
                badge.innerText = data.fuente;
                badge.className = data.fuente === 'cache' ? 'badge hit' : 'badge miss';
                document.getElementById('resultadoBox').style.display = 'block';
            } catch (error) { alert('Error de conexión con el Backend'); }
        }

        async function limpiarCache() {
            try {
                const response = await fetch(`${API_URL}/cache/limpiar`);
                const data = await response.json();
                alert(data.mensaje);
                document.getElementById('resultadoBox').style.display = 'none';
            } catch (error) { alert('Error al limpiar el caché'); }
        }
    </script>
</body>
</html>
```

Guardar (**Ctrl+O → Enter → Ctrl+X**) y aplicar permisos:

```bash
sudo chown -R www-data:www-data /var/www/html/Sistema
sudo systemctl restart apache2
sudo ufw allow 8080/tcp
```

> ⚠️ **Nota importante:** el frontend usa `const API_URL = 'http://192.168.100.20:3000'`, que apunta a la IP interna de VM2. Esto funciona porque el navegador de tu PC llega a VM3 por el reenvío de puertos, y desde dentro de la red interna VM3 puede alcanzar a VM2 directamente.

---

## ✅ FASE 5 — Verificación Final

### Checklist antes de abrir el navegador

- [ ] **VM1** encendida — `sudo systemctl status redis-server` → `active (running)`
- [ ] **VM2** encendida — `node index.js` o el proceso corriendo en background
- [ ] **VM3** encendida — `sudo systemctl status apache2` → `active (running)`
- [ ] `enp0s8` activa en todas las VMs — `ip a | grep 192.168.100`
- [ ] Redis alcanzable desde VM2 — `redis-cli -h 192.168.100.10 ping` → `PONG`
- [ ] Apache sirve el HTML — `curl http://localhost:8080/Sistema/index.html` (desde VM3)

### Probar el sistema

1. Abrí el navegador en tu PC: **`http://localhost:8080/Sistema/index.html`**
2. Ingresá `5` en el campo X → clic en **Calcular ✨**
   - Primera vez → badge amarillo **CALCULO** → `y = 68`
3. Ingresá `5` de nuevo → clic en **Calcular ✨**
   - Segunda vez → badge verde **CACHE** → `y = 68` ← ¡el caché funcionó!
4. Clic en **Limpiar Caché 🧹** → ingresá `5` de nuevo → debe volver a calcular

### Verificación matemática

| x  | Cálculo             | y esperado |
|----|---------------------|------------|
| 0  | 2(0)²+5(0)+3        | 3          |
| 1  | 2(1)²+5(1)+3        | 10         |
| 2  | 2(2)²+5(2)+3        | 21         |
| 5  | 2(5)²+5(5)+3        | 68         |
| -1 | 2(-1)²+5(-1)+3      | 0          |
| 10 | 2(10)²+5(10)+3      | 253        |

---

## 🔧 IPs persistentes con Netplan (aplicar en VM1 y VM2 también)

Para que las IPs de la red interna no se pierdan al reiniciar, configurar Netplan en **cada VM**:

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

**VM1:**
```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      addresses: [192.168.100.10/24]
```

**VM2:**
```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      addresses: [192.168.100.20/24]
```

**VM3:**
```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      addresses: [192.168.100.30/24]
```

En las 3 VMs:
```bash
sudo chmod 600 /etc/netplan/00-installer-config.yaml
sudo netplan apply
ip a   # verificar que enp0s8 tiene la IP correcta
```

---

## 🐛 Errores frecuentes y soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `ECONNREFUSED 192.168.100.10:6379` | Redis no corre o enp0s8 de VM1 DOWN | `sudo systemctl start redis-server` en VM1; levantar enp0s8 |
| Badge siempre dice `CALCULO` | Redis no guarda (conexión fallida silenciosa) | Verificar desde VM2: `redis-cli -h 192.168.100.10 ping` |
| `Error de conexión con el Backend` | Backend no corre en VM2 | Correr `node index.js` en VM2; revisar puerto 3000 en VirtualBox |
| Página no carga (8080) | Apache caído o falta reenvío de puertos | `sudo systemctl restart apache2`; agregar regla en VirtualBox |
| `Cannot find module 'ioredis'` | Dependencia no instalada | `cd ~/backend && npm install ioredis` en VM2 |
| enp0s8 DOWN al reiniciar | IPs manuales no persisten | Configurar Netplan (ver sección anterior) |
| `bind: Cannot assign requested address` | Problema con `bind 0.0.0.0` en Redis | Cambiar a `bind 127.0.0.1 192.168.100.10` en `/etc/redis/redis.conf` |
| `Failed to fetch` en apt update | Sin gateway/DNS | `sudo ip route add default via 10.0.2.2` y `echo 'nameserver 8.8.8.8' \| sudo tee /etc/resolv.conf` |

---

## 📁 Estructura del proyecto

```
VM1 (Redis - 192.168.100.10)
└── Caché en memoria
    └── Claves: resultado:X → valor Y (TTL: 1 hora)

VM2 (Node.js - 192.168.100.20)
└── ~/backend/
    ├── index.js         ← servidor Express + lógica caché
    ├── package.json
    └── node_modules/

VM3 (Apache - 192.168.100.30)
└── /var/www/html/
    └── Sistema/
        └── index.html   ← frontend rosita con fetch API
```

---

*Alumna: Gonzalez, Agostina*