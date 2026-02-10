import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Send, Phone, User, Building2, MessageSquare, Loader2, CheckCircle2, Clock, Instagram, Mail, Bell } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";

import { mockApi, MOCK_ACCOUNTS, type Message } from "@/lib/mock-service";

const formSchema = z.object({
  subAccountId: z.string().min(1, "Please select an account"),
  contactPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  messageBody: z.string().min(1, "Message cannot be empty").max(1600, "Message too long"),
  channel: z.enum(["sms", "instagram"]).default("sms"),
});

// Extend Message type for this view
interface UnifiedMessage extends Message {
  channel?: 'sms' | 'instagram' | 'email';
}

export default function SmsDashboard() {
  const [selectedAccount, setSelectedAccount] = useState<string>(MOCK_ACCOUNTS[0].id);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subAccountId: MOCK_ACCOUNTS[0].id,
      contactPhone: "+15559999",
      messageBody: "",
      channel: "sms",
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

  // Simulate incoming Instagram message
  const simulateInstagramMessage = () => {
    if (!instagramConnected) {
      toast({
        variant: "destructive",
        title: "Integration Required",
        description: "Please connect your Instagram account first.",
      });
      return;
    }

    const newMessage: UnifiedMessage = {
      id: `ig_${Date.now()}`,
      subAccountId: selectedAccount,
      direction: 'inbound',
      body: "Hey! Saw your story about the 6-week challenge. Can I get more info?",
      status: 'received',
      createdAt: new Date().toISOString(),
      contactPhone: "instagram_user_123",
      channel: "instagram"
    };
    
    setMessages(prev => [...prev, newMessage]);
    toast({
      title: "New Instagram Message",
      description: "Received from @instagram_user_123",
    });
  };

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
      // Manually add the channel for visual demo
      const msgWithChannel: UnifiedMessage = {
        ...response.message,
        channel: values.channel as any
      };
      
      setMessages((prev) => [...prev, msgWithChannel]);
      form.resetField("messageBody");
      toast({
        title: "Message sent",
        description: `Your ${values.channel === 'instagram' ? 'DM' : 'SMS'} has been sent.`,
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
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Unified Inbox</h1>
            <p className="text-sm text-muted-foreground">Manage all your customer conversations in one place.</p>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Active Account
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
              </div>

              <div className="space-y-3 pt-2 border-t border-border">
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-pink-100 rounded-md">
                        <Instagram className="h-4 w-4 text-pink-600" />
                      </div>
                      <span className="text-sm font-medium">Instagram</span>
                    </div>
                    <Switch 
                      checked={instagramConnected}
                      onCheckedChange={setInstagramConnected}
                    />
                 </div>
                 {instagramConnected && (
                   <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs"
                    onClick={simulateInstagramMessage}
                  >
                    <Bell className="mr-2 h-3 w-3" />
                    Simulate Incoming DM
                  </Button>
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
                  <h3 className="font-semibold text-primary">Omnichannel Ready</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected to Twilio (SMS) and Meta Graph API (Instagram).
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
              <div className="flex gap-2">
                 <Badge variant="outline" className="gap-1">
                   <Phone className="h-3 w-3" /> SMS
                 </Badge>
                 <Badge variant="outline" className={`gap-1 ${!instagramConnected && 'opacity-50'}`}>
                   <Instagram className="h-3 w-3" /> Instagram
                 </Badge>
              </div>
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
                      <div className={`flex flex-col ${msg.direction === 'outbound' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                        <div className="flex items-center gap-1 mb-1 px-1">
                           {msg.channel === 'instagram' ? (
                             <Instagram className="h-3 w-3 text-pink-500" />
                           ) : (
                             <MessageSquare className="h-3 w-3 text-blue-500" />
                           )}
                           <span className="text-[10px] text-muted-foreground capitalize">{msg.channel || 'sms'}</span>
                        </div>
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm ${
                            msg.direction === 'outbound'
                              ? 'bg-primary text-primary-foreground rounded-br-none'
                              : 'bg-white border border-border text-foreground rounded-bl-none'
                          }`}
                        >
                          <p className="text-sm leading-relaxed">{msg.body}</p>
                        </div>
                        <div className={`flex items-center gap-1 mt-1 text-[10px] ${
                          msg.direction === 'outbound' ? 'text-muted-foreground' : 'text-muted-foreground'
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
                  
                  {/* Channel Selector for Sending */}
                  {instagramConnected && (
                    <div className="flex gap-2 mb-2">
                       <Button
                        type="button"
                        variant={form.watch("channel") === "sms" ? "default" : "outline"}
                        size="sm"
                        onClick={() => form.setValue("channel", "sms")}
                        className="text-xs h-7"
                       >
                         <Phone className="mr-1.5 h-3 w-3" /> SMS
                       </Button>
                       <Button
                        type="button"
                        variant={form.watch("channel") === "instagram" ? "default" : "outline"}
                        size="sm"
                        onClick={() => form.setValue("channel", "instagram")}
                        className={`text-xs h-7 ${form.watch("channel") === "instagram" ? "bg-pink-600 hover:bg-pink-700" : ""}`}
                       >
                         <Instagram className="mr-1.5 h-3 w-3" /> Instagram
                       </Button>
                    </div>
                  )}

                  <div className="relative">
                    <FormField
                      control={form.control}
                      name="messageBody"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              placeholder={`Type your ${form.watch("channel") === 'instagram' ? 'DM' : 'SMS'}...`}
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
                        className={`h-8 w-8 rounded-full shadow-sm ${form.watch("channel") === 'instagram' ? 'bg-pink-600 hover:bg-pink-700' : ''}`}
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
