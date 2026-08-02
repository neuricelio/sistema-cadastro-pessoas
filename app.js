const express = require('express');
const ejs = require('ejs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const fs = require('fs-extra');

const app = express();
const caminhoPasta = path.join(__dirname, 'pasta-fotos');

// Cria pasta de fotos automaticamente
fs.ensureDirSync(caminhoPasta);

// ------------------------------
// CONEXÃO COM BANCO
// ------------------------------
const bd = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Testa conexão
async function iniciarBanco(){
  try {
    console.log('🔌 Conectando ao banco...');
    const conn = await bd.getConnection();
    console.log('✅ Conectado ao MySQL!');
    conn.release();
  } catch(e) {
    console.error('❌ Erro no banco:', e.message);
  }
}
iniciarBanco();

// ------------------------------
// CONFIGURAÇÕES
// ------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/fotos', express.static(caminhoPasta));
app.set('view engine', 'ejs');

// SESSÃO AJUSTADA PARA RENDER ✅
app.use(session({
  secret: process.env.SECRET || 'sistema-cadastro-2026-seguro-unico',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ------------------------------
// UPLOAD
// ------------------------------
const armazenamento = multer.diskStorage({
  destination: (req, arq, cb) => cb(null, caminhoPasta),
  filename: (req, arq, cb) => cb(null, Date.now() + '-' + arq.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: armazenamento, limits: { fileSize: 5 * 1024 * 1024 } });

// ------------------------------
// MIDDLEWARE
// ------------------------------
function soLogado(req, res, next) {
  if (!req.session.usuario) return res.redirect('/');
  next();
}

// ------------------------------
// ROTAS
// ------------------------------
app.get('/', (req, res) => res.render('login', { erro: null, sucesso: req.query.sucesso || null }));

// LOGIN COM VERIFICAÇÃO ✅
app.post('/logar', async (req, res) => {
  try {
    const { login, senha } = req.body;
    const [usuarios] = await bd.execute(`SELECT * FROM usuarios WHERE login = ?`, [login]);
    const usu = usuarios[0];
    if (!usu) return res.render('login', { erro: 'Usuário não encontrado' });

    const senhaCorreta = await bcrypt.compare(senha, usu.senha);
    if (!senhaCorreta) return res.render('login', { erro: 'Senha incorreta' });

    req.session.usuario = { id: usu.id, login: usu.login, nivel: usu.nivel };
    res.redirect('/inicial');
  } catch(e) {
    res.render('login', { erro: e.message });
  }
});

app.get('/inicial', soLogado, (req, res) => res.render('inicial', { usuario: req.session.usuario }));
app.get('/sair', (req, res) => { req.session.destroy(); res.redirect('/'); });

// CADASTRO DE USUÁRIO COM CRIPTOGRAFIA ✅
app.get('/cadastrar-usuario', soLogado, (req, res) => {
  res.render('cadastrar-usuario', { erro: null, sucesso: null, usuario: req.session.usuario });
});

app.post('/cadastrar-usuario', soLogado, async (req, res) => {
  try {
    const { login, senha, nome, nivel } = req.body;
    const nivelFinal = req.session.usuario.nivel === 'admin' ? (nivel || 'usuario') : 'usuario';

    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, [login]);
    if (existe.length) return res.render('cadastrar-usuario', { erro: 'Usuário já existe!', usuario: req.session.usuario });

    // ✅ CRIPTOGRAFA A SENHA ANTES DE SALVAR
    const senhaCript = await bcrypt.hash(senha, 10);
    await bd.execute(`INSERT INTO usuarios (login, senha, nome, nivel) VALUES (?, ?, ?, ?)`, [login, senhaCript, nome || login, nivelFinal]);
    
    res.render('cadastrar-usuario', { sucesso: 'Usuário criado com sucesso!', erro: null, usuario: req.session.usuario });
  } catch(e) {
    res.render('cadastrar-usuario', { erro: e.message, sucesso: null, usuario: req.session.usuario });
  }
});

// ROTAS DE CRIAÇÃO (USE UMA VEZ SÓ)
app.get('/criar-tabelas', async (req, res) => {
  try {
    await bd.execute(`CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, login VARCHAR(50) UNIQUE NOT NULL, senha VARCHAR(255) NOT NULL, nome VARCHAR(100), nivel ENUM('admin','usuario') DEFAULT 'usuario') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await bd.execute(`CREATE TABLE IF NOT EXISTS pessoas (id INT AUTO_INCREMENT PRIMARY KEY, siapen VARCHAR(20), nome VARCHAR(150) NOT NULL, cpf CHAR(14) UNIQUE NOT NULL, rg VARCHAR(20), nascimento DATE, mae VARCHAR(150), pai VARCHAR(150), cep CHAR(10), rua VARCHAR(150), numero VARCHAR(10), bairro VARCHAR(100), cidade VARCHAR(100), uf CHAR(2), complemento VARCHAR(100), processo_unificado VARCHAR(50), pena_total VARCHAR(20), data_progressao DATE, fotos TEXT, ativo TINYINT DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await bd.execute(`CREATE TABLE IF NOT EXISTS processos_originais (id INT AUTO_INCREMENT PRIMARY KEY, id_processo_unificado INT NOT NULL, numero VARCHAR(50), data DATE, tipificacao TEXT, descricao TEXT, FOREIGN KEY (id_processo_unificado) REFERENCES pessoas(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await bd.execute(`CREATE TABLE IF NOT EXISTS auditoria (id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(50), acao VARCHAR(50), id_pessoa INT, dados_anteriores TEXT, dados_novos TEXT, data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    res.send('✅ Tabelas criadas! <br><a href="/criar-admin">Criar Admin</a>');
  } catch(e) { res.send('❌ Erro: ' + e.message); }
});

app.get('/criar-admin', async (req, res) => {
  try {
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length) return res.send('✅ Admin já existe! <br><a href="/">Ir ao Login</a>');
    const hash = await bcrypt.hash('admin123', 10);
    await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
    res.send('✅ Admin criado! <br>Login: admin | Senha: admin123 <br><a href="/">Ir ao Login</a>');
  } catch(e) { res.send('❌ Erro: ' + e.message); }
});

// DEMAIS ROTAS
app.get('/cadastro', soLogado, (req, res) => res.render('cadastro', { pessoa: null, processos: [], usuario: req.session.usuario }));
app.get('/busca', soLogado, (req, res) => res.render('busca', { usuario: req.session.usuario }));
app.get('/editar/:id', soLogado, async (req, res) => {
  const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
  const [processos] = await bd.execute(`SELECT * FROM processos_originais WHERE id_processo_unificado = ?`, [req.params.id]);
  res.render('cadastro', { pessoa: pessoas[0], processos, usuario: req.session.usuario });
});
app.get('/ver/:id', soLogado, async (req, res) => {
  const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
  const [processos] = await bd.execute(`SELECT * FROM processos_originais WHERE id_processo_unificado = ?`, [req.params.id]);
  res.render('cadastro', { pessoa: pessoas[0], processos, usuario: req.session.usuario, modoVisualizacao: true });
});
app.get('/buscar-nomes', soLogado, async (req, res) => {
  const termo = `%${req.query.nome || ''}%`;
  const [linhas] = await bd.execute(`SELECT id, nome FROM pessoas WHERE nome LIKE ? AND ativo = 1 ORDER BY nome LIMIT 50`, [termo]);
  res.json(linhas);
});

// SALVAR CADASTRO
app.post('/salvar', soLogado, upload.array('fotos', 10), async (req, res) => {
  try {
    const dados = req.body;
    let fotos = dados.fotos_antigas || '';
    if (req.files?.length) {
      fotos = req.files.map(f => f.filename).join(', ');
      if (dados.fotos_antigas) dados.fotos_antigas.split(',').map(f => fs.remove(path.join(caminhoPasta, f.trim())));
    }

    const numsProc = Array.isArray(req.body.proc_numero) ? req.body.proc_numero : [req.body.proc_numero];
    const datasProc = Array.isArray(req.body.proc_data) ? req.body.proc_data : [req.body.proc_data];
    const tipsProc = Array.isArray(req.body.proc_tipificacao) ? req.body.proc_tipificacao : [req.body.proc_tipificacao];
    const descsProc = Array.isArray(req.body.proc_descricao) ? req.body.proc_descricao : [req.body.proc_descricao];

    async function salvarProc(idPessoa) {
      await bd.execute(`DELETE FROM processos_originais WHERE id_processo_unificado = ?`, [idPessoa]);
      for(let i=0; i<numsProc.length; i++){
        if(!numsProc[i] && !datasProc[i] && !tipsProc[i] && !descsProc[i]) continue;
        await bd.execute(`INSERT INTO processos_originais VALUES (NULL,?,?,?,?,?)`, [idPessoa, numsProc[i]||'', datasProc[i]||null, tipsProc[i]||'', descsProc[i]||'']);
      }
    }

    if (dados.id) {
      const [ant] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [dados.id]);
      await bd.execute(`UPDATE pessoas SET siapen=?,nome=?,cpf=?,rg=?,nascimento=?,mae=?,pai=?,cep=?,rua=?,numero=?,bairro=?,cidade=?,uf=?,complemento=?,processo_unificado=?,pena_total=?,data_progressao=?,fotos=? WHERE id=?`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos,dados.id]);
      await bd.execute(`INSERT INTO auditoria VALUES (NULL,?,?,?,?,?,NOW())`, [req.session.usuario.login,'ALTERAÇÃO',dados.id,JSON.stringify(ant[0]),JSON.stringify({...dados,fotos})]);
      await salvarProc(dados.id);
    } else {
      const [resIns] = await bd.execute(`INSERT INTO pessoas VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos]);
      await bd.execute(`INSERT INTO auditoria VALUES (NULL,?,?,?,?,?,NOW())`, [req.session.usuario.login,'CADASTRO',resIns.insertId,null,JSON.stringify({...dados,fotos})]);
      await salvarProc(resIns.insertId);
    }
    res.redirect('/busca');
  } catch(e) { res.send(`Erro: ${e.message}<br><a href="/cadastro">Voltar</a>`); }
});

app.post('/desativar/:id', soLogado, async (req, res) => {
  await bd.execute(`UPDATE pessoas SET ativo = 0 WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria VALUES (NULL,?,?,?,NULL,NULL,NOW())`, [req.session.usuario.login,'DESATIVAÇÃO',req.params.id]);
  res.redirect('/busca');
});

app.post('/excluir/:id', soLogado, async (req, res) => {
  if (req.session.usuario.nivel !== 'admin') return res.status(403).send('Acesso negado');
  await bd.execute(`DELETE FROM pessoas WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria VALUES (NULL,?,?,?,NULL,NULL,NOW())`, [req.session.usuario.login,'EXCLUSÃO',req.params.id]);
  res.redirect('/busca');
});

// INICIO
const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`✅ Sistema online na porta ${porta}`));
