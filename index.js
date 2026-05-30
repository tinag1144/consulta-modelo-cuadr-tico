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