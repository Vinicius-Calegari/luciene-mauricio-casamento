import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('private');
mkdirSync(target, { recursive: true });
const filename = resolve(target, 'acessos-dos-noivos.json');
if (existsSync(filename)) throw new Error('Os códigos já foram gerados. Preserve o arquivo privado existente.');
const entries = ['luciene', 'mauricio'].map(side => {
  const code = randomBytes(32).toString('base64url');
  return { side, code, hash: createHash('sha256').update(code).digest('hex') };
});
writeFileSync(filename, JSON.stringify({ createdAt: new Date().toISOString(), entries }, null, 2));
writeFileSync(resolve(target, 'ACESSOS-DOS-NOIVOS.txt'), [
  'ACESSOS PRIVADOS — LUCIENE & MAURICIO',
  'Painel: https://vinicius-calegari.github.io/luciene-mauricio-casamento/?painel=1',
  '',
  'Clique em Primeiro acesso. Use seu código abaixo, seu e-mail e uma senha com 12 caracteres ou mais.',
  'Cada código funciona uma única vez e atribui somente o lado correspondente.',
  'Depois da ativação, entre com o e-mail e a senha escolhidos.',
  '',
  ...entries.map(e => e.side.toUpperCase() + ': ' + e.code),
  '',
  'Guarde este arquivo em local privado. Não publique os códigos nem adicione este arquivo ao GitHub.'
].join('\n'));
console.log(JSON.stringify({ hashes: entries.map(({side,hash})=>({side,hash})), privateFile: resolve(target,'ACESSOS-DOS-NOIVOS.txt') }));
