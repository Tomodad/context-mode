using System;
using System.IO;
using System.Text;

// CMJ1: five bounded length-prefixed UTF-8 strings, then one Boolean byte.
// BinaryReader.ReadBytes does not read past the requested frame. The original
// control pipe remains open for Run's synchronous EOF/cancellation checks.
public static class ContextModeWindowsJobEntry {
    static string Field(BinaryReader reader) {
        int size=reader.ReadInt32();
        if(size<0 || size>4194304) throw new InvalidDataException();
        byte[] bytes=reader.ReadBytes(size);
        if(bytes.Length!=size) throw new EndOfStreamException();
        return new UTF8Encoding(false,true).GetString(bytes);
    }
    public static int Main(string[] arguments) {
        Console.OutputEncoding=new UTF8Encoding(false);
        if(arguments.Length==1 && arguments[0]=="--check") { Console.WriteLine("CMJ1");return 0; }
        try {
            using(var reader=new BinaryReader(Console.OpenStandardInput())) {
                if(reader.ReadInt32()!=0x314a4d43) throw new InvalidDataException();
                string exe=Field(reader), command=Field(reader), cwd=Field(reader), environment=Field(reader), name=Field(reader);
                byte terminate=reader.ReadByte();
                if(terminate>1) throw new InvalidDataException();
                return ContextModeWindowsJob.Run(exe,command,cwd,environment,name,terminate==1);
            }
        } catch(Exception error) {
            Console.Error.WriteLine("[context-mode job] helper failed: "+error.GetType().Name);
            return 1;
        }
    }
}
