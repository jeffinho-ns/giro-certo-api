-- Script para criar usuário administrador
-- Execute este script no PostgreSQL após executar add-user-role.sql

-- Importante: Certifique-se de que o enum UserRole e a coluna role já existam
-- Execute primeiro: scripts/add-user-role.sql

-- Criar usuário admin (senha: @123Mudar)
-- A senha será hashada usando bcrypt
-- Hash gerado para "@123Mudar": $2a$10$rK8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X8X

-- Primeiro, vamos gerar o hash da senha usando Node.js/bcrypt
-- Por enquanto, vamos criar um script Node.js para isso

-- NOTA: Execute o script create-admin-user.js ao invés deste SQL diretamente
-- O script Node.js irá gerar o hash correto da senha
