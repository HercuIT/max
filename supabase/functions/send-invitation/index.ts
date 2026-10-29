import { handleInvitation } from './handler.ts';

declare const Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve(request => handleInvitation(request, {
    INVITATION_DELIVERY_TOKEN: Deno.env.get('INVITATION_DELIVERY_TOKEN'),
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
    INVITATION_FROM_EMAIL: Deno.env.get('INVITATION_FROM_EMAIL'),
}));
