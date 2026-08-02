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

// ✅ CRIA PASTA DE FOTOS AUTOMATICAMENTE SE NÃO EXISTIR
fs.ensureDirSync(caminhoPasta);

// ------------------------------
// CONEXÃO COM MYSQL
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

// Inicializa banco e usuário admin automaticamente
async function iniciarBanco(){
  try {
    console.log('========================================');
    console.log('🔍 TENTANDO CONECTAR NO BANCO DE DADOS:');
    console.log('   DB_HOST    =', process.env.DB_HOST || '❌ NÃO DEFINIDO!');
    console.log('   DB_PORT    =', process.env.DB_PORT || '❌ NÃO DEFINIDO!');
    console.log('   DB_USER    =', process.env.DB_USER || '❌ NÃO DEFINIDO!');
    console.log('   DB_NAME    =', process.env.DB_NAME || '❌ NÃO DEFINIDO!');
    console.log('   DB_PASS    =', process.env.DB_PASS ? '✅ DEFINIDA (' + process.env.DB_PASS.length + ' caracteres)' : '❌ NÃO DEFINIDA!');
    console.log('========================================');

    const conn = await bd.getConnection();
    console.log('✅ CONECTADO AO MYSQL COM SUCESSO!');
    console.log('   Thread ID:', conn.threadId);
    conn.release();

    // Cria admin se não existir
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`,
        ['admin', hash, 'admin']);
      console.log('✅ Usuário admin criado: admin / admin123');
    } else {
      console.log('ℹ️ Usuário admin já existe, pulando criação.');
    }

  } catch(e) {
    console.error('========================================');
    console.error('❌ ERRO NO BANCO:', e.message);
    console.error('========================================');
  }
}
iniciarBanco();

// ------------------------------
// CONFIGURAÇÕES GERAIS
// ------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/fotos', express.static(caminhoPasta));
app.set('view engine', 'ejs');
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
// UPLOAD DE FOTOS
// ------------------------------
const armazenamento = multer.diskStorage({
  destination: (req, arq, cb) => cb(null, caminhoPasta),
  filename: (req, arq, cb) => cb(null, Date.now() + '-' + arq.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: armazenamento, limits: { fileSize: 5 * 1024 * 1024 } });

// ------------------------------
// MIDDLEWARE DE ACESSO
// ------------------------------
function soLogado(req, res, next) {
  if (!req.session.usuario) return res.redirect('/');
  next();
}

// ------------------------------
// ROTAS PÚBLICAS
// ------------------------------
app.get('/cadastrar-usuario', soLogado, (req, res) => {
  res.render('cadastrar-usuario', {
    erro: null,
    sucesso: req.query.sucesso || null,
    usuario: req.session.usuario
  });
});

app.post('/cadastrar-usuario', soLogado, async (req, res) => {
  try {
    const { login, senha, nome, nivel } = req.body;

    let nivelFinal = 'usuario';
    if (req.session.usuario && req.session.usuario.nivel === 'admin') {
      nivelFinal = nivel || 'usuario';
    }

    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, [login]);
    if (existe.length > 0) {
      return res.render('cadastrar-usuario', { erro: 'Esse usuário já existe!', sucesso: null, usuario: req.session.usuario });
    }

    // ✅ CRIPTOGRAFA A SENHA ANTES DE SALVAR
    const senhaCript = await bcrypt.hash(senha, 10);

    await bd.execute(
      `INSERT INTO usuarios (login, senha, nome, nivel) VALUES (?, ?, ?, ?)`,
      [login, senhaCript, nome || login, nivelFinal]
    );

    res.redirect('/cadastrar-usuario?sucesso=Usuário criado com sucesso!');
  } catch (erro) {
    res.render('cadastrar-usuario', { erro: 'Erro: ' + erro.message, sucesso: null, usuario: req.session.usuario });
  }
});

app.get('/', (req, res) => res.render('login', { erro: undefined, sucesso: req.query.sucesso || null }));

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

app.get('/inicial', soLogado, (req, res) => {
  res.render('inicial', { usuario: req.session.usuario });
});

app.get('/sair', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ------------------------------
// ROTAS TEMPORÁRIAS — USE UMA VEZ SÓ
// ------------------------------
app.get('/criar-tabelas', async (req, res) => {
  try {
    await bd.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      login VARCHAR(50) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      nome VARCHAR(100),
      nivel ENUM('admin','usuario') DEFAULT 'usuario'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      siapen VARCHAR(20), nome VARCHAR(150) NOT NULL,
      cpf CHAR(14) UNIQUE NOT NULL, rg VARCHAR(20),
      nascimento DATE, mae VARCHAR(150), pai VARCHAR(150),
      cep CHAR(10), rua VARCHAR(150), numero VARCHAR(10),
      bairro VARCHAR(100), cidade VARCHAR(100), uf CHAR(2),
      complemento VARCHAR(100), processo_unificado VARCHAR(50),
      pena_total VARCHAR(20), data_progressao DATE,
      fotos TEXT, ativo TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS processos_originais (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_processo_unificado INT NOT NULL,
      numero VARCHAR(50), data DATE,
      tipificacao TEXT, descricao TEXT,
      FOREIGN KEY (id_processo_unificado) REFERENCES pessoas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await bd.execute(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50), acao VARCHAR(50),
      id_pessoa INT, dados_anteriores TEXT, dados_novos TEXT,
      data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    res.send('✅ TODAS AS TABELAS CRIADAS COM SUCESSO! <br><br><a href="/criar-admin">Criar usuário admin</a>');
  } catch (e) {
    res.send('❌ ERRO: ' + e.message);
  }
});

app.get('/criar-admin', async (req, res) => {
  try {
    const [existe] = await bd.execute(`SELECT id FROM usuarios WHERE login = ?`, ['admin']);
    if (existe.length > 0) {
      return res.send('✅ Admin já existe! <br><br><a href="/">Ir para login</a>');
    }
    const hash = await bcrypt.hash('admin123', 10);
    await bd.execute(`INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
    res.send('✅ Usuário admin criado com sucesso! <br><br>🔑 Login: <b>admin</b><br>🔒 Senha: <b>admin123</b><br><br><a href="/">Ir para login</a>');
  } catch (e) {
    res.send('❌ ERRO: ' + e.message);
  }
});

// ------------------------------
// ROTAS PROTEGIDAS
// ------------------------------
app.get('/cadastro', soLogado, (req, res) => {
  res.render('cadastro', { pessoa: null, processos: [], usuario: req.session.usuario });
});

app.get('/busca', soLogado, (req, res) => {
  res.render('busca', { usuario: req.session.usuario });
});

app.get('/editar/:id', soLogado, async (req, res) => {
  const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
  const pessoa = pessoas[0];
  const [processos] = await bd.execute(`SELECT numero,data,tipificacao,descricao FROM processos_originais WHERE id_processo_unificado = ? ORDER BY id`, [req.params.id]);
  res.render('cadastro', { pessoa, processos, usuario: req.session.usuario });
});

app.get('/ver/:id', soLogado, async (req, res) => {
  try {
    const [pessoas] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [req.params.id]);
    const pessoa = pessoas[0];
    const [processos] = await bd.execute(`SELECT * FROM processos_originais WHERE id_processo_unificado = ? ORDER BY id`, [req.params.id]);
    res.render('cadastro', { pessoa, processos, usuario: req.session.usuario, modoVisualizacao: true });
  } catch {
    res.redirect('/busca');
  }
});

app.get('/buscar-nomes', soLogado, async (req, res) => {
  const termo = `%${req.query.nome || ''}%`;
  const [linhas] = await bd.execute(`SELECT id, nome FROM pessoas WHERE nome LIKE ? AND ativo = 1 ORDER BY nome LIMIT 50`, [termo]);
  res.json(linhas);
});

// ------------------------------
// SALVAR CADASTRO/ALTERAÇÃO
// ------------------------------
app.post('/salvar', soLogado, upload.array('fotos', 10), async (req, res) => {
  try {
    const dados = req.body;
    let fotos = dados.fotos_antigas || '';

    if (req.files && req.files.length > 0) {
      const novasFotos = req.files.map(f => f.filename).join(', ');
      fotos = novasFotos;
      if (dados.fotos_antigas) {
        dados.fotos_antigas.split(',').map(f => f.trim()).filter(f => f).forEach(nome => fs.remove(path.join(caminhoPasta, nome)));
      }
    }

    const numsProc = Array.isArray(req.body.proc_numero) ? req.body.proc_numero : (req.body.proc_numero ? [req.body.proc_numero] : []);
    const datasProc = Array.isArray(req.body.proc_data) ? req.body.proc_data : (req.body.proc_data ? [req.body.proc_data] : []);
    const tipsProc = Array.isArray(req.body.proc_tipificacao) ? req.body.proc_tipificacao : (req.body.proc_tipificacao ? [req.body.proc_tipificacao] : []);
    const descsProc = Array.isArray(req.body.proc_descricao) ? req.body.proc_descricao : (req.body.proc_descricao ? [req.body.proc_descricao] : []);

    async function salvarProcessosOriginais(idPessoa) {
      await bd.execute(`DELETE FROM processos_originais WHERE id_processo_unificado = ?`, [idPessoa]);
      for(let i=0; i < numsProc.length; i++){
        const num = (numsProc[i]||'').trim();
        const dt = (datasProc[i]||'').trim();
        const tip = (tipsProc[i]||'').trim();
        const desc = (descsProc[i]||'').trim();
        if(!num && !dt && !tip && !desc) continue;
        await bd.execute(
          `INSERT INTO processos_originais (id_processo_unificado,numero,data,tipificacao,descricao) 
          VALUES (?,?,?,?,?)`,[idPessoa, num, dt || null, tip, desc]
        );
      }
    }

    if (dados.id) {
      const [antigos] = await bd.execute(`SELECT * FROM pessoas WHERE id = ?`, [dados.id]);
      const antigo = antigos[0];

      await bd.execute(`UPDATE pessoas SET siapen=?,nome=?,cpf=?,rg=?,nascimento=?,mae=?,pai=?,cep=?,rua=?,numero=?,bairro=?,cidade=?,uf=?,complemento=?,processo_unificado=?,pena_total=?,data_progressao=?,fotos=? WHERE id=?`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos,dados.id]);

      await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_anteriores,dados_novos) VALUES (?,?,?,?,?)`,
        [req.session.usuario.login,'ALTERAÇÃO',dados.id,JSON.stringify(antigo),JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(dados.id);
      res.redirect('/busca');
    } else {
      const [result] = await bd.execute(`INSERT INTO pessoas (siapen,nome,cpf,rg,nascimento,mae,pai,cep,rua,numero,bairro,cidade,uf,complemento,processo_unificado,pena_total,data_progressao,fotos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [dados.siapen,dados.nome,dados.cpf,dados.rg,dados.nascimento||null,dados.mae,dados.pai,dados.cep,dados.rua,dados.numero,dados.bairro,dados.cidade,dados.uf,dados.complemento,dados.processo_unificado,dados.pena_total,dados.data_progressao||null,fotos]);

      await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa,dados_novos) VALUES (?,?,?,?)`,
        [req.session.usuario.login,'CADASTRO NOVO',result.insertId,JSON.stringify({...dados,fotos})]);

      await salvarProcessosOriginais(result.insertId);
      res.redirect('/busca');
    }
  } catch(erro) {
    console.error('ERRO SALVAR:', erro);
    res.send(`<h3>Erro: ${erro.message}</h3><a href="/cadastro">Voltar</a>`);
  }
});

// ------------------------------
// DESATIVAR / EXCLUIR
// ------------------------------
app.post('/desativar/:id', soLogado, async (req, res) => {
  await bd.execute(`UPDATE pessoas SET ativo = 0 WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa) VALUES (?,?,?)`, [req.session.usuario.login,'DESATIVAÇÃO',req.params.id]);
  res.redirect('/busca');
});

app.post('/excluir/:id', soLogado, async (req, res) => {
  if (req.session.usuario.nivel !== 'admin') return res.status(403).send('Acesso negado');
  await bd.execute(`DELETE FROM pessoas WHERE id = ?`, [req.params.id]);
  await bd.execute(`INSERT INTO auditoria (usuario,acao,id_pessoa) VALUES (?,?,?)`, [req.session.usuario.login,'EXCLUSÃO',req.params.id]);
  res.redirect('/busca');
});

// ===============================================================================================
// ✅ INICIA O SERVIDOR
// ===============================================================================================
const porta = process.env.PORT || 3000;

app.listen(porta, () => {
  console.log(`✅ Sistema rodando na porta ${porta}`);
  console.log('🔑 Login padrão: admin / admin123');
}).on('error', (erro) => {
  console.error('❌ Erro ao iniciar servidor:', erro.message);
  process.exit(1);
});
