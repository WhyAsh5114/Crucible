-- Add isAnonymous field required by the better-auth anonymous plugin
ALTER TABLE "user" ADD COLUMN "isAnonymous" BOOLEAN DEFAULT false;
