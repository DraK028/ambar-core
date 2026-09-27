import { Body, Controller, Delete, Get, HttpCode, Inject, Param, PipeTransform, Post } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';
import { AssistantService } from '../application/assistant.service';
import { CurrentUser, Public, type AuthedUser } from './auth.guard';
import { ValidationError } from './problem.filter';

class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T, private readonly where = 'body') {}
  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(
        `El ${this.where} no cumple el contrato.`,
        parsed.error.issues.map((i) => ({ path: i.path.join('.') || this.where, message: i.message })),
      );
    }
    return parsed.data;
  }
}

const MessageBody = z
  .object({
    conversation_id: z.string().uuid().optional(),
    message: z.string().trim().min(1, 'escribe una pregunta').max(1000, 'máximo 1000 caracteres'),
  })
  .strict();

const IdParam = new ZodPipe(z.string().uuid(), 'parámetro de ruta');

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health() {
    return { status: 'ok' };
  }
}

@Controller('v1/assistant')
export class AssistantController {
  constructor(@Inject(AssistantService) private readonly assistant: AssistantService) {}

  @Post('messages')
  @HttpCode(200)
  send(@CurrentUser() user: AuthedUser, @Body(new ZodPipe(MessageBody)) body: z.infer<typeof MessageBody>) {
    return this.assistant.handle({
      ownerId: user.sub,
      accessToken: user.accessToken,
      conversationId: body.conversation_id,
      message: body.message,
    });
  }

  @Get('conversations/:conversationId')
  async get(@CurrentUser() user: AuthedUser, @Param('conversationId', IdParam) id: string) {
    const c = await this.assistant.getConversation(user.sub, id);
    return { id: c.id, messages: c.messages, created_at: c.created_at, expires_at: c.expires_at };
  }

  @Delete('conversations/:conversationId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthedUser, @Param('conversationId', IdParam) id: string) {
    await this.assistant.deleteConversation(user.sub, id);
  }
}
