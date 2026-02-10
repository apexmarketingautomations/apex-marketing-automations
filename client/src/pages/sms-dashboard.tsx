import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Send, Phone, User, Building2, MessageSquare, Loader2, CheckCircle2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

import { mockApi, MOCK_ACCOUNTS, type Message } from "@/lib/mock-service";

const formSchema = z.object({
  subAccountId: z.string().min(1, "Please select an account"),
  contactPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  messageBody: z.string().min(1, "Message cannot be empty").max(1600, "Message too long"),
});

export default function SmsDashboard() {
  const [selectedAccount, setSelectedAccount] = useState<string>(MOCK_ACCOUNTS[0].id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subAccountId: MOCK_ACCOUNTS[0].id,
      contactPhone: "+15559999",
      messageBody: "",
    },
  });

  // Load initial data
  useEffect(() => {
    const loadMessages = async () => {
      setIsLoading(true);
      const data = await mockApi.getMessages(selectedAccount);
      setMessages(data);
      setIsLoading(false);
    };
    loadMessages();
  }, [selectedAccount]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSending(true);
    try {
      const response = await mockApi.sendSms(values);
      setMessages((prev) => [...prev, response.message]);
      form.resetField("messageBody");
      toast({
        title: "Message sent",
        description: "Your SMS has been successfully queued for delivery.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send message. Please try again.",
      });
    } finally {
      setIsSending(false);
    }
  }

  const currentAccount = MOCK_ACCOUNTS.find(a => a.id === selectedAccount);

  return (
    <div className="p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Sidebar: Configuration */}
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Messaging</h1>
            <p className="text-sm text-muted-foreground">Manage your SMS communications.</p>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Sending Account
                </label>
                <Select 
                  value={selectedAccount} 
                  onValueChange={(val) => {
                    setSelectedAccount(val);
                    form.setValue("subAccountId", val);
                  }}
                >
                  <SelectTrigger data-testid="select-account">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_ACCOUNTS.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span>{acc.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentAccount && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    From: <span className="font-mono text-foreground bg-muted px-1 rounded">{currentAccount.twilioNumber}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20 shadow-none">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-primary/10 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-primary">System Online</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Twilio services are operational. Queue status is normal.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content: Chat Interface */}
        <div className="md:col-span-2 h-[calc(100vh-4rem)] md:h-[800px] flex flex-col">
          <Card className="flex-1 flex flex-col shadow-md border-border overflow-hidden">
            
            {/* Header */}
            <div className="p-4 border-b border-border bg-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                  <User className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">
                    {form.watch("contactPhone") || "New Conversation"}
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-muted-foreground">Active now</span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon">
                <Phone className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4 bg-muted/30">
              <div className="space-y-4 flex flex-col">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full py-10">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mb-2 opacity-20" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                          msg.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground rounded-br-none'
                            : 'bg-white border border-border text-foreground rounded-bl-none'
                        }`}
                      >
                        <p className="text-sm leading-relaxed">{msg.body}</p>
                        <div className={`flex items-center gap-1 mt-1 text-[10px] ${
                          msg.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}>
                          <span>{format(new Date(msg.createdAt), 'h:mm a')}</span>
                          {msg.direction === 'outbound' && (
                             <span className="uppercase font-medium">• {msg.status}</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {/* Composer */}
            <div className="p-4 bg-card border-t border-border">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  
                  {/* Recipient Input (Visual only for this demo, usually fixed in a thread) */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-muted-foreground">To:</span>
                    <FormField
                      control={form.control}
                      name="contactPhone"
                      render={({ field }) => (
                        <input 
                          {...field}
                          className="text-xs bg-transparent border-none focus:outline-none text-foreground font-mono w-full"
                          placeholder="Enter phone number..."
                        />
                      )}
                    />
                  </div>

                  <div className="relative">
                    <FormField
                      control={form.control}
                      name="messageBody"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              placeholder="Type your message..."
                              className="min-h-[80px] resize-none pr-12 text-sm bg-muted/30 border-muted-foreground/20 focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                              {...field}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  form.handleSubmit(onSubmit)();
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="absolute bottom-2 right-2">
                       <Button 
                        type="submit" 
                        size="icon" 
                        disabled={isSending || !form.watch("messageBody")}
                        className="h-8 w-8 rounded-full shadow-sm"
                        data-testid="button-send"
                      >
                        {isSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <p>Press Enter to send</p>
                    <p>{form.watch("messageBody")?.length || 0}/1600 characters</p>
                  </div>
                </form>
              </Form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
