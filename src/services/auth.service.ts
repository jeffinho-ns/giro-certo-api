import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { query, queryOne, transaction } from '../lib/db';
import { CreateUserDto, LoginDto, User, PilotProfile, UserRole } from '../types';
import { generateId } from '../utils/id';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export class AuthService {
  async register(data: CreateUserDto) {
    // Verificar se o email já existe
    const existingUser = await queryOne<User>(
      'SELECT * FROM "User" WHERE email = $1',
      [data.email]
    );

    if (existingUser) {
      throw new Error('Email já cadastrado');
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const userId = generateId();
    const walletId = generateId();
    const pilotProfile = data.pilotProfile || PilotProfile.URBANO;

    // Criar usuário e wallet em uma transação
    await transaction(async (client) => {
      // Criar usuário
      await client.query(
        `INSERT INTO "User" (
          id, name, email, password, age, "photoUrl", "pilotProfile", role,
          "isSubscriber", "subscriptionType", "loyaltyPoints",
          "currentLat", "currentLng", "isOnline", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
        [
          userId,
          data.name,
          data.email,
          hashedPassword,
          data.age,
          data.photoUrl || null,
          pilotProfile,
          UserRole.USER, // Todos os novos usuários começam como USER
          false,
          'standard',
          0,
          null,
          null,
          false,
        ]
      );

      // Criar wallet
      await client.query(
        `INSERT INTO "Wallet" (id, "userId", balance, "totalEarned", "totalWithdrawn", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [walletId, userId, 0, 0, 0]
      );
    });

    // Buscar usuário criado
    const user = await queryOne<User>(
      `SELECT id, name, email, age, "photoUrl", "pilotProfile", role,
              "isSubscriber", "subscriptionType", "loyaltyPoints"
       FROM "User" WHERE id = $1`,
      [userId]
    );

    if (!user) {
      throw new Error('Erro ao criar usuário');
    }

    // Gerar token
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn } as SignOptions
    );

    return { user, token };
  }

  async login(data: LoginDto) {
    // Buscar usuário
    const user = await queryOne<User>(
      'SELECT * FROM "User" WHERE email = $1',
      [data.email]
    );

    if (!user) {
      throw new Error('Email ou senha inválidos');
    }

    // Verificar senha
    const validPassword = await bcrypt.compare(data.password, user.password);

    if (!validPassword) {
      throw new Error('Email ou senha inválidos');
    }

    // Gerar token
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn } as SignOptions
    );

    // Atualizar status online
    await query(
      'UPDATE "User" SET "isOnline" = $1, "updatedAt" = NOW() WHERE id = $2',
      [true, user.id]
    );

    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  }

  async logout(userId: string) {
    await query(
      'UPDATE "User" SET "isOnline" = $1, "updatedAt" = NOW() WHERE id = $2',
      [false, userId]
    );

    return { message: 'Logout realizado com sucesso' };
  }
}
